/**
 * Read-only SQL guard for the assistant SQL scratchpad (DuckDB).
 *
 * Accepts exactly one SELECT or WITH statement. The returned statement has comments replaced by spaces and the
 * trailing semicolon removed, so callers can safely wrap it in a subquery. String literals and quoted identifiers
 * are kept verbatim. DuckDB itself also runs with external access disabled; this guard is the first layer.
 */
export type SqlGuardResult = { ok: true; statement: string } | { ok: false; reason: string };

export const MAX_SQL_LENGTH = 20_000;

const ALLOWED_FIRST_KEYWORDS = new Set(['SELECT', 'WITH']);

const FORBIDDEN_KEYWORDS = new Set([
    'ALTER',
    'ATTACH',
    'BEGIN',
    'CALL',
    'CHECKPOINT',
    'COMMIT',
    'COPY',
    'CREATE',
    'DEALLOCATE',
    'DELETE',
    'DETACH',
    'DROP',
    'EXECUTE',
    'EXPORT',
    'GRANT',
    'IMPORT',
    'INSERT',
    'INSTALL',
    'LOAD',
    'MERGE',
    'PRAGMA',
    'PREPARE',
    'RESET',
    'REVOKE',
    'ROLLBACK',
    'SET',
    'TRUNCATE',
    'UPDATE',
    'USE',
    'VACUUM',
]);

const FORBIDDEN_FUNCTION =
    /^(read_[a-z0-9_]*|[a-z0-9_]+_scan|glob|sniff_csv|query|query_table|parquet_metadata|parquet_file_metadata|parquet_kv_metadata|parquet_schema)$/i;

/** A name that DuckDB would resolve as a file or URL (replacement scan): a path, a URL, a glob or a file extension. */
const FILE_LIKE_NAME = /[\\/*]|:\/\/|^[A-Za-z][A-Za-z0-9+.-]+:|\.[A-Za-z0-9]{1,8}$/;

interface Lexed {
    /** Original text with comments replaced by a space. */
    clean: string;
    /** Like clean, but string literals become '' and quoted identifiers become "". */
    skeleton: string;
    /** Offsets in `clean` of semicolons outside strings, identifiers and comments. */
    semicolons: number[];
    /** Raw contents (without the quotes) of each string literal and quoted identifier, in order of their `''`/`""` placeholders in the skeleton. */
    literals: string[];
    error?: string;
}

/** Matches DuckDB's scanner: letters, digits, underscore, `$` after the first character, and any non-ASCII code point. */
const isIdentChar = (char: string | undefined): boolean => char !== undefined && (/[A-Za-z0-9_$]/.test(char) || char.charCodeAt(0) >= 0x80);

const CLAUSE_RESET_KEYWORDS = new Set([
    'SELECT',
    'WHERE',
    'GROUP',
    'HAVING',
    'ORDER',
    'LIMIT',
    'OFFSET',
    'QUALIFY',
    'WINDOW',
    'UNION',
    'INTERSECT',
    'EXCEPT',
    'WITH',
]);

/**
 * Returns the contents of every string literal or quoted identifier that sits in a table reference position:
 * directly after FROM, JOIN or LATERAL, or after a comma inside a FROM clause (at the same parenthesis depth).
 */
function tableReferenceLiterals(skeleton: string, literals: string[]): string[] {
    const found: string[] = [];
    const clauses: boolean[] = [false];
    let previous = '';
    let literalIndex = 0;
    for (const token of skeleton.matchAll(/''|""|[A-Za-z_][A-Za-z0-9_$]*|[(),]/g)) {
        const text = token[0];
        const upper = text.toUpperCase();
        if (text === "''" || text === '""') {
            const inFromClause = clauses[clauses.length - 1];
            if (previous === 'FROM' || previous === 'JOIN' || previous === 'LATERAL' || (previous === ',' && inFromClause)) {
                found.push(literals[literalIndex] ?? '');
            }
            literalIndex += 1;
        } else if (text === '(') {
            clauses.push(false);
        } else if (text === ')') {
            if (clauses.length > 1) clauses.pop();
        } else if (upper === 'FROM' || upper === 'JOIN') {
            clauses[clauses.length - 1] = true;
        } else if (CLAUSE_RESET_KEYWORDS.has(upper)) {
            clauses[clauses.length - 1] = false;
        }
        previous = text === "''" || text === '""' ? 'LITERAL' : upper;
    }
    return found;
}

function isEscapeStringStart(sql: string, quoteIndex: number): boolean {
    const prefix = sql[quoteIndex - 1];
    return (prefix === 'e' || prefix === 'E') && !isIdentChar(sql[quoteIndex - 2]);
}

function lex(sql: string): Lexed {
    let clean = '';
    let skeleton = '';
    const semicolons: number[] = [];
    const literals: string[] = [];
    let i = 0;
    const n = sql.length;

    while (i < n) {
        const ch = sql[i];
        const next = sql[i + 1];

        if (ch === '-' && next === '-') {
            const end = sql.indexOf('\n', i + 2);
            i = end === -1 ? n : end;
            clean += ' ';
            skeleton += ' ';
            continue;
        }

        if (ch === '/' && next === '*') {
            let depth = 1;
            let j = i + 2;
            while (j < n && depth > 0) {
                if (sql[j] === '/' && sql[j + 1] === '*') {
                    depth += 1;
                    j += 2;
                } else if (sql[j] === '*' && sql[j + 1] === '/') {
                    depth -= 1;
                    j += 2;
                } else {
                    j += 1;
                }
            }
            if (depth > 0) return { clean, skeleton, semicolons, literals, error: 'Unterminated block comment' };
            i = j;
            clean += ' ';
            skeleton += ' ';
            continue;
        }

        if (ch === "'") {
            const backslashEscapes = isEscapeStringStart(sql, i);
            let j = i + 1;
            let closed = false;
            while (j < n) {
                if (backslashEscapes && sql[j] === '\\') {
                    j += 2;
                    continue;
                }
                if (sql[j] === "'") {
                    if (sql[j + 1] === "'") {
                        j += 2;
                        continue;
                    }
                    closed = true;
                    j += 1;
                    break;
                }
                j += 1;
            }
            if (!closed) return { clean, skeleton, semicolons, literals, error: 'Unterminated string literal' };
            clean += sql.slice(i, j);
            skeleton += "''";
            literals.push(sql.slice(i + 1, j - 1));
            i = j;
            continue;
        }

        if (ch === '"') {
            let j = i + 1;
            let closed = false;
            while (j < n) {
                if (sql[j] === '"') {
                    if (sql[j + 1] === '"') {
                        j += 2;
                        continue;
                    }
                    closed = true;
                    j += 1;
                    break;
                }
                j += 1;
            }
            if (!closed) return { clean, skeleton, semicolons, literals, error: 'Unterminated quoted identifier' };
            clean += sql.slice(i, j);
            skeleton += '""';
            literals.push(sql.slice(i + 1, j - 1));
            i = j;
            continue;
        }

        if (ch === '$' && !isIdentChar(sql[i - 1])) {
            const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
            if (tag) {
                const end = sql.indexOf(tag[0], i + tag[0].length);
                if (end === -1) return { clean, skeleton, semicolons, literals, error: 'Unterminated dollar-quoted string' };
                clean += sql.slice(i, end + tag[0].length);
                skeleton += "''";
                literals.push(sql.slice(i + tag[0].length, end));
                i = end + tag[0].length;
                continue;
            }
        }

        if (ch === ';') semicolons.push(clean.length);
        clean += ch;
        skeleton += ch;
        i += 1;
    }

    return { clean, skeleton, semicolons, literals };
}

/** Checks that `sql` is a single read-only SELECT or WITH statement. */
export function checkReadOnlySql(sql: string): SqlGuardResult {
    if (sql.length > MAX_SQL_LENGTH) return { ok: false, reason: `The query is longer than ${MAX_SQL_LENGTH} characters` };

    const lexed = lex(sql);
    if (lexed.error) return { ok: false, reason: lexed.error };

    const segments: string[] = [];
    let start = 0;
    for (const position of lexed.semicolons) {
        segments.push(lexed.clean.slice(start, position));
        start = position + 1;
    }
    segments.push(lexed.clean.slice(start));
    const statements = segments.map(segment => segment.trim()).filter(segment => segment !== '');

    if (statements.length === 0) return { ok: false, reason: 'The query is empty' };
    if (statements.length > 1) return { ok: false, reason: 'Only one statement is allowed' };

    const statement = statements[0];
    const { skeleton, literals } = lex(statement);

    const firstWord = /^[A-Za-z]+/.exec(skeleton.replace(/^[\s(]+/, ''));
    if (!firstWord || !ALLOWED_FIRST_KEYWORDS.has(firstWord[0].toUpperCase())) {
        return { ok: false, reason: 'Only SELECT or WITH queries are allowed' };
    }

    const words = skeleton.toUpperCase().split(/[^A-Z0-9_]+/);
    const forbidden = words.find(word => FORBIDDEN_KEYWORDS.has(word));
    if (forbidden) {
        return {
            ok: false,
            reason: `"${forbidden}" is not allowed. Only read-only queries are accepted. Put identifiers that look like keywords in double quotes.`,
        };
    }

    if (/""\s*\(/.test(skeleton)) {
        return { ok: false, reason: 'A quoted identifier cannot be used as a function name' };
    }

    if (tableReferenceLiterals(skeleton, literals).some(name => FILE_LIKE_NAME.test(name))) {
        return { ok: false, reason: 'Reading a file or URL is not allowed. Query the data handles instead.' };
    }

    const calls = skeleton.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/g);
    for (const call of calls) {
        if (FORBIDDEN_FUNCTION.test(call[1])) {
            return { ok: false, reason: `The function ${call[1]}() is not allowed. Query the data handles instead.` };
        }
    }

    return { ok: true, statement };
}
