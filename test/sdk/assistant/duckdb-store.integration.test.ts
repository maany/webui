/**
 * @jest-environment node
 */
import type { DuckDbEngine } from '@/lib/infrastructure/assistant/duckdb/duckdb-engine';
import { DuckDbDataHandleStore } from '@/lib/infrastructure/assistant/duckdb/duckdb-data-handle-store';
import { createNodeDuckDbEngine } from 'test/fixtures/assistant/node-duckdb-engine';
import { rowsOf } from 'test/fixtures/assistant/fake-duckdb-engine';

jest.setTimeout(60_000);

const provenance = { toolName: 'list_rules', args: {}, fetchedAt: '2026-10-25T10:00:00.000Z' };
const RULES = [
    { id: 'a', state: 'Stuck', rse_expression: 'CERN-PROD', locks_stuck_cnt: 3, created_at: '2026-10-01T10:00:00.000Z' },
    { id: 'b', state: 'OK', rse_expression: 'CERN-PROD', locks_stuck_cnt: 0, created_at: '2026-10-02T10:00:00.000Z' },
    { id: 'c', state: 'Stuck', rse_expression: 'BNL-OSG2', locks_stuck_cnt: 1, created_at: '2026-10-03T10:00:00.000Z' },
];

describe('DuckDbDataHandleStore on real DuckDB', () => {
    let engine: DuckDbEngine;
    let store: DuckDbDataHandleStore;

    beforeAll(async () => {
        engine = await createNodeDuckDbEngine();
        store = new DuckDbDataHandleStore(async () => engine);
        await store.ingestRows('rules', provenance, rowsOf(RULES), { rowCap: 50_000 });
    });

    afterAll(async () => {
        await store.terminate();
    });

    it('infers DuckDB column types', () => {
        const columns = Object.fromEntries(store.listHandles()[0].columns.map(column => [column.name, column.type]));
        expect(columns).toMatchObject({ id: 'VARCHAR', state: 'VARCHAR', locks_stuck_cnt: expect.stringMatching(/INT/) });
    });

    it('counts stuck rules by RSE', async () => {
        const result = await store.query("SELECT rse_expression, count(*) AS n FROM rules_1 WHERE state = 'Stuck' GROUP BY 1 ORDER BY 1", {
            maxRows: 200,
        });
        expect(result).toEqual({
            columns: ['rse_expression', 'n'],
            rows: [
                { rse_expression: 'BNL-OSG2', n: 1 },
                { rse_expression: 'CERN-PROD', n: 1 },
            ],
            totalRows: 2,
        });
    });

    it('keeps ORDER BY and LIMIT of the wrapped statement and formats timestamps', async () => {
        const result = await store.query(
            'WITH t AS (SELECT id, CAST(created_at AS TIMESTAMP) AS created FROM rules_1) SELECT * FROM t ORDER BY created DESC',
            { maxRows: 1 },
        );
        expect(result.totalRows).toBe(3);
        expect(result.rows).toEqual([{ id: 'c', created: '2026-10-03T10:00:00.000Z' }]);
    });

    it('saves a result and joins across handles', async () => {
        await store.ingestRows(
            'rses',
            { ...provenance, toolName: 'list_rses' },
            rowsOf([
                { name: 'CERN-PROD', tier: 0 },
                { name: 'BNL-OSG2', tier: 1 },
            ]),
            { rowCap: 10 },
        );
        await store.query("SELECT * FROM rules_1 WHERE state = 'Stuck'", { maxRows: 0, saveAs: 'stuck' });
        const joined = await store.query('SELECT s.id, r.tier FROM stuck s JOIN rses_1 r ON r.name = s.rse_expression ORDER BY s.id', {
            maxRows: 10,
        });
        expect(joined.rows).toEqual([
            { id: 'a', tier: 0 },
            { id: 'c', tier: 1 },
        ]);
    });

    it('stores mixed and nested values as text', async () => {
        const handle = await store.ingestRows(
            'attrs',
            provenance,
            rowsOf([
                { value: true, meta: { k: 1 } },
                { value: 'x', meta: null },
            ]),
            { rowCap: 10 },
        );
        expect(handle.columns).toEqual([
            { name: 'meta', type: 'VARCHAR' },
            { name: 'value', type: 'VARCHAR' },
        ]);
    });

    it('blocks file access and configuration changes inside DuckDB itself', async () => {
        await expect(engine.query("SELECT * FROM read_csv('/etc/passwd')")).rejects.toThrow(/disabled by configuration/);
        await expect(engine.exec("SET memory_limit = '1GB'")).rejects.toThrow(/configuration has been locked/);
        await expect(engine.exec("COPY rules_1 TO 'out.csv'")).rejects.toThrow(/disabled by configuration/);
    });

    describe('bypass attempts leave the data intact', () => {
        // The guard must reject these before DuckDB sees them.
        const guarded = [
            'SELECT 1 AS a$$$; DROP TABLE rules_1; SELECT 1 AS b$$',
            'SELECT 1 AS é$$; DROP TABLE rules_1; SELECT é$$',
            "SELECT * FROM rules_1, '/etc/passwd'",
            "SELECT * FROM 'https://example.com/x.csv'",
            `"read_csv"('/etc/passwd')`,
            "SELECT * FROM query('SELECT 1')",
        ];

        async function expectRulesIntact(): Promise<void> {
            const result = await engine.query('SELECT count(*) AS n FROM rules_1');
            expect(result.rows).toEqual([{ n: 3 }]);
        }

        it.each(guarded)('query is rejected by the guard: %s', async sql => {
            await expect(store.query(sql, { maxRows: 10 })).rejects.toMatchObject({ code: 'invalid_sql' });
            await expectRulesIntact();
        });

        it.each(guarded)('saveAs is rejected by the guard: %s', async sql => {
            await expect(store.query(sql, { maxRows: 10, saveAs: 'bypassed' })).rejects.toMatchObject({ code: 'invalid_sql' });
            expect(store.listHandles().some(handle => handle.name === 'bypassed')).toBe(false);
            await expect(engine.query('SELECT * FROM bypassed')).rejects.toThrow();
            await expectRulesIntact();
        });

        it('keeps the engine lock-down: no local file reads, no config changes', async () => {
            await expect(engine.query("SELECT * FROM read_csv('/etc/hostname')")).rejects.toThrow(/disabled by configuration/);
            await expect(engine.query("SELECT * FROM read_text('/etc/hostname')")).rejects.toThrow(/disabled by configuration/);
            await expect(engine.exec('SET lock_configuration = false')).rejects.toThrow();
        });
    });

    it('reports memory use', async () => {
        await expect(store.memoryBytes()).resolves.toBeGreaterThan(0);
    });

    it('drops tables on dropAll', async () => {
        await store.dropAll();
        await expect(engine.query('SELECT * FROM rules_1')).rejects.toThrow('Table with name rules_1 does not exist');
    });
});
