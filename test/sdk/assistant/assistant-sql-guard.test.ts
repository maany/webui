import { checkReadOnlySql, MAX_SQL_LENGTH } from '@/lib/core/services/assistant-sql-guard';

const accepted = (sql: string): string => {
    const result = checkReadOnlySql(sql);
    if (!result.ok) throw new Error(`expected "${sql}" to be accepted, got: ${result.reason}`);
    return result.statement;
};

const rejected = (sql: string): string => {
    const result = checkReadOnlySql(sql);
    if (result.ok) throw new Error(`expected "${sql}" to be rejected`);
    return result.reason;
};

describe('checkReadOnlySql', () => {
    it('accepts a plain SELECT and returns it trimmed', () => {
        expect(accepted('  SELECT state, count(*) AS n FROM rules_1 GROUP BY state  ')).toBe(
            'SELECT state, count(*) AS n FROM rules_1 GROUP BY state',
        );
    });

    it('accepts lower case and multi line queries', () => {
        expect(accepted("select *\nfrom rules_1\nwhere state = 'Stuck'")).toBe("select *\nfrom rules_1\nwhere state = 'Stuck'");
    });

    it('accepts a CTE', () => {
        const sql = "WITH stuck AS (SELECT * FROM rules_1 WHERE state = 'Stuck') SELECT rse_expression, count(*) FROM stuck GROUP BY 1";
        expect(accepted(sql)).toBe(sql);
    });

    it('accepts parenthesised set operations', () => {
        expect(accepted('(SELECT name FROM rses_1) UNION ALL (SELECT name FROM rses_2)')).toContain('UNION ALL');
    });

    it('strips one trailing semicolon and trailing comments', () => {
        expect(accepted('SELECT 1;')).toBe('SELECT 1');
        expect(accepted('SELECT 1; -- done')).toBe('SELECT 1');
        expect(accepted('SELECT 1 ; ;')).toBe('SELECT 1');
    });

    it('replaces comments so the statement can be wrapped in a subquery', () => {
        expect(accepted('SELECT 1 -- trailing note')).toBe('SELECT 1');
        expect(accepted('/* lead */ SELECT /* inner */ 1')).toBe('SELECT   1');
        expect(accepted('-- first line\nSELECT 2')).toBe('SELECT 2');
    });

    it('keeps semicolons and keywords inside string literals', () => {
        const sql = "SELECT 'a;b' AS x, 'DROP TABLE rules_1' AS y";
        expect(accepted(sql)).toBe(sql);
    });

    it('handles doubled quotes inside strings', () => {
        expect(accepted("SELECT 'it''s; fine' AS x")).toBe("SELECT 'it''s; fine' AS x");
    });

    it('handles backslash escapes inside E strings', () => {
        const sql = "SELECT E'a\\'; b' AS x";
        expect(accepted(sql)).toBe(sql);
    });

    it('handles dollar-quoted strings', () => {
        const sql = 'SELECT $$;DROP TABLE t;$$ AS x, $tag$ ; $tag$ AS y';
        expect(accepted(sql)).toBe(sql);
    });

    it('allows keywords inside quoted identifiers', () => {
        expect(accepted('SELECT "set", "update" FROM rules_1')).toBe('SELECT "set", "update" FROM rules_1');
    });

    it('does not treat column names that contain keywords as keywords', () => {
        expect(accepted('SELECT updated_at, created_at, settings_count FROM rules_1')).toContain('updated_at');
    });

    it('rejects an empty query', () => {
        expect(rejected('')).toBe('The query is empty');
        expect(rejected(' ; -- nothing')).toBe('The query is empty');
    });

    it('rejects more than one statement', () => {
        expect(rejected('SELECT 1; SELECT 2')).toBe('Only one statement is allowed');
        expect(rejected('SELECT 1; DROP TABLE rules_1')).toBe('Only one statement is allowed');
        expect(rejected("SELECT 'x'; DELETE FROM rules_1")).toBe('Only one statement is allowed');
    });

    it('rejects statements that do not start with SELECT or WITH', () => {
        for (const sql of ['DESCRIBE rules_1', 'SUMMARIZE rules_1', 'EXPLAIN SELECT 1', 'VALUES (1)', 'FROM rules_1 SELECT *', 'SHOW TABLES']) {
            expect(rejected(sql)).toBe('Only SELECT or WITH queries are allowed');
        }
    });

    it.each([
        ["COPY rules_1 TO 'out.csv'"],
        ["ATTACH 'other.db' AS other"],
        ['INSTALL httpfs'],
        ['LOAD httpfs'],
        ['PRAGMA version'],
        ['SET threads = 1'],
        ['CREATE TABLE x AS SELECT 1'],
        ['DROP TABLE rules_1'],
        ['INSERT INTO rules_1 VALUES (1)'],
        ['UPDATE rules_1 SET state = 1'],
        ['DELETE FROM rules_1'],
        ['DETACH other'],
        ['CALL pragma_version()'],
    ])('rejects %s', sql => {
        expect(checkReadOnlySql(sql).ok).toBe(false);
    });

    it('rejects write keywords hidden after a CTE', () => {
        expect(rejected('WITH x AS (SELECT 1) INSERT INTO rules_1 SELECT * FROM x')).toContain('"INSERT" is not allowed');
    });

    it('ignores semicolons and keywords inside comments', () => {
        expect(accepted('SELECT 1 /* ; DROP TABLE x */')).toBe('SELECT 1');
        expect(rejected('/* SELECT */ DROP TABLE rules_1')).toBe('Only SELECT or WITH queries are allowed');
    });

    it('rejects file reading functions', () => {
        expect(rejected("SELECT * FROM read_csv('/etc/passwd')")).toContain('read_csv()');
        expect(rejected("SELECT * FROM read_json_auto('x.json')")).toContain('read_json_auto()');
        expect(rejected("SELECT * FROM parquet_scan('x')")).toContain('parquet_scan()');
        expect(rejected("SELECT * FROM glob('*')")).toContain('glob()');
    });

    it('rejects unterminated strings, identifiers and comments', () => {
        expect(rejected("SELECT 'oops")).toBe('Unterminated string literal');
        expect(rejected('SELECT "oops')).toBe('Unterminated quoted identifier');
        expect(rejected('SELECT 1 /* oops')).toBe('Unterminated block comment');
        expect(rejected('SELECT $$oops')).toBe('Unterminated dollar-quoted string');
    });

    it('rejects queries over the length limit', () => {
        expect(rejected(`SELECT '${'x'.repeat(MAX_SQL_LENGTH)}'`)).toContain(`${MAX_SQL_LENGTH} characters`);
    });

    it('rejects a quoted identifier used as a function call', () => {
        expect(rejected(`SELECT * FROM "read_csv"('/etc/passwd')`)).toContain('quoted');
        expect(rejected(`SELECT * FROM "read_csv" ('x.csv')`)).toContain('quoted');
        expect(rejected(`SELECT "a"(1)`)).toContain('quoted');
    });

    it('does not reject quoted identifiers that are not called', () => {
        expect(accepted('SELECT "a", "b" FROM "rules_1" WHERE "a" IN (1, 2)')).toContain('"rules_1"');
    });

    it.each(['query', 'query_table', 'parquet_metadata', 'parquet_file_metadata', 'parquet_kv_metadata', 'parquet_schema'])(
        'rejects the function %s()',
        fn => {
            expect(rejected(`SELECT * FROM ${fn}('x')`)).toContain(`${fn}()`);
        },
    );

    it('rejects file-like or URL-like names directly after FROM or JOIN', () => {
        expect(rejected("SELECT * FROM '/etc/passwd'")).toContain('file');
        expect(rejected("SELECT * FROM 'https://example.com/x.csv'")).toContain('file');
        expect(rejected('SELECT * FROM "data.parquet"')).toContain('file');
        expect(rejected("SELECT * FROM rules_1 a JOIN 'x.csv' b ON a.id = b.id")).toContain('file');
        expect(rejected("select * from\n  'data.json'")).toContain('file');
        expect(rejected("SELECT * FROM '*.csv'")).toContain('file');
    });

    it('allows plain quoted table names and file-like text inside other strings', () => {
        expect(accepted('SELECT * FROM "rules_1"')).toBe('SELECT * FROM "rules_1"');
        expect(accepted("SELECT 'FROM ''x.csv''' AS note, name FROM rses_1")).toContain('rses_1');
        expect(accepted("SELECT * FROM rses_1 WHERE name = '/etc/passwd'")).toContain('/etc/passwd');
    });

    describe('fix round 1', () => {
        it('treats $ and non-ASCII characters as identifier characters', () => {
            expect(rejected('SELECT 1 AS a$$$; DROP TABLE rules_1; SELECT 1 AS b$$')).toBeTruthy();
            expect(rejected('SELECT 1 AS é$$; DROP TABLE rules_1; SELECT é$$')).toBeTruthy();
            expect(rejected("SELECT éE'\\'; DROP TABLE x; SELECT '")).toBeTruthy();
            expect(accepted('SELECT 1 AS a$b')).toBe('SELECT 1 AS a$b');
            expect(accepted("SELECT 'é' AS x")).toBe("SELECT 'é' AS x");
        });

        it('rejects file-like names in every table reference position', () => {
            expect(rejected("SELECT * FROM rules_1, '/etc/passwd'")).toContain('file');
            expect(rejected("SELECT * FROM rules_1 JOIN rses_1 ON true, 'https://h/x.parquet'")).toContain('file');
            expect(rejected("SELECT * FROM LATERAL '/etc/passwd'")).toContain('file');
            expect(rejected("SELECT * FROM rules_1 a, LATERAL 'x.csv'")).toContain('file');
            expect(rejected('SELECT * FROM rules_1, "data.parquet"')).toContain('file');
            expect(rejected("SELECT * FROM (SELECT 1) t, 'x.csv'")).toContain('file');
        });

        it('allows literals in the select list, where and function arguments', () => {
            expect(accepted("SELECT a, 'x.csv' AS f FROM t")).toContain('x.csv');
            expect(accepted("SELECT * FROM t WHERE a IN ('x.csv', 'y.csv')")).toContain('y.csv');
            expect(accepted("SELECT * FROM t GROUP BY a, 'x.csv'")).toContain('x.csv');
            expect(accepted("SELECT concat(a, 'x.csv') FROM t")).toContain('x.csv');
        });

        it.each(['s3:bucket/key', 'gcs:b/k', 'http:x', 'https:x', 'hf:datasets/x', 'az:c/b', 'azure:c/b', 'r2:b/k', 'S3:b'])(
            'rejects the scheme prefix in %s',
            name => {
                expect(rejected(`SELECT * FROM '${name}'`)).toContain('file');
            },
        );
    });

    describe('fix round 2', () => {
        it('does not split identifiers at non-ASCII characters when tracking the FROM clause', () => {
            expect(rejected("SELECT * FROM rules_1 AS éselect, '/etc/passwd'")).toContain('file');
            expect(rejected("SELECT * FROM rules_1 éwhere, 'https://h/x.parquet'")).toContain('file');
            expect(rejected("SELECT * FROM rules_1 t JOIN rses_1 éorder ON true, 'x.csv'")).toContain('file');
            expect(rejected("SELECT * FROM rules_1 AS selecté, 'x.csv'")).toContain('file');
        });
    });
});
