import { ENGINE_INIT_SQL, type DuckDbEngine } from '@/lib/infrastructure/assistant/duckdb/duckdb-engine';
import {
    DataHandleStoreError,
    DEFAULT_IDLE_MS,
    DEFAULT_MAX_ROWS,
    DuckDbDataHandleStore,
    tableBaseName,
} from '@/lib/infrastructure/assistant/duckdb/duckdb-data-handle-store';
import { FakeDuckDbEngine, rowsOf } from 'test/fixtures/assistant/fake-duckdb-engine';

const provenance = { toolName: 'list_rules', args: { state: 'Stuck' }, fetchedAt: '2026-10-25T10:00:00.000Z' };

function setup() {
    const engine = new FakeDuckDbEngine();
    const factory = jest.fn(async () => engine);
    const store = new DuckDbDataHandleStore(factory, { now: () => new Date('2026-10-25T12:00:00.000Z') });
    return { engine, factory, store };
}

describe('tableBaseName', () => {
    it('sanitises base names', () => {
        expect(tableBaseName('rules')).toBe('rules');
        expect(tableBaseName('List-Rules!')).toBe('list_rules');
        expect(tableBaseName('9lives')).toBe('t_9lives');
        expect(tableBaseName('***')).toBe('t');
    });
});

describe('DuckDbDataHandleStore.ingestRows', () => {
    it('names tables <base>_<n> and keeps provenance', async () => {
        const { store } = setup();
        const first = await store.ingestRows('rules', provenance, rowsOf([{ id: 'a', state: 'Stuck' }]), { rowCap: 10 });
        const second = await store.ingestRows('rules', provenance, rowsOf([{ id: 'b', state: 'OK' }]), { rowCap: 10 });
        const other = await store.ingestRows('did_rules', provenance, rowsOf([{ id: 'c' }]), { rowCap: 10 });
        expect([first.name, second.name, other.name]).toEqual(['rules_1', 'rules_2', 'did_rules_1']);
        expect(first).toEqual({
            name: 'rules_1',
            provenance,
            rowCount: 1,
            truncated: false,
            columns: [
                { name: 'id', type: 'VARCHAR' },
                { name: 'state', type: 'VARCHAR' },
            ],
            status: 'live',
        });
    });

    it('secures the engine once before the first statement', async () => {
        const { engine, factory, store } = setup();
        await store.ingestRows('rules', provenance, rowsOf([{ id: 'a' }]), { rowCap: 10 });
        await store.ingestRows('rules', provenance, rowsOf([{ id: 'b' }]), { rowCap: 10 });
        expect(factory).toHaveBeenCalledTimes(1);
        expect(engine.executed.slice(0, ENGINE_INIT_SQL.length)).toEqual([...ENGINE_INIT_SQL]);
        expect(engine.executed.filter(sql => sql.startsWith('SET '))).toHaveLength(ENGINE_INIT_SQL.length);
    });

    it('normalises mixed column types before inserting', async () => {
        const { engine, store } = setup();
        await store.ingestRows('attrs', provenance, rowsOf([{ value: true }, { value: 'x' }]), { rowCap: 10 });
        expect(engine.tables.get('attrs_1')).toEqual([{ value: 'true' }, { value: 'x' }]);
    });

    it('stops reading at the row cap and marks the handle truncated', async () => {
        const { engine, store } = setup();
        let pulled = 0;
        let closed = false;
        async function* source() {
            try {
                for (let i = 0; i < 5; i += 1) {
                    pulled += 1;
                    yield { i };
                }
            } finally {
                closed = true;
            }
        }
        const handle = await store.ingestRows('rules', provenance, source(), { rowCap: 2 });
        expect(handle.rowCount).toBe(2);
        expect(handle.truncated).toBe(true);
        expect(pulled).toBe(3);
        expect(closed).toBe(true);
        expect(engine.tables.get('rules_1')).toEqual([{ i: 0 }, { i: 1 }]);
    });

    it('is not truncated when the rows fit the cap exactly', async () => {
        const { store } = setup();
        const handle = await store.ingestRows('rules', provenance, rowsOf([{ i: 0 }, { i: 1 }]), { rowCap: 2 });
        expect(handle.truncated).toBe(false);
    });

    it('marks the handle truncated with an error when the source failed part way', async () => {
        const { store } = setup();
        const handle = await store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), {
            rowCap: 10,
            sourceError: () => 'Stream failed after 1 rows: gateway error',
        });
        expect(handle.truncated).toBe(true);
        expect(handle.error).toBe('Stream failed after 1 rows: gateway error');
    });

    it('creates an empty table without columns for zero rows', async () => {
        const { engine, store } = setup();
        const handle = await store.ingestRows('rules', provenance, rowsOf([]), { rowCap: 10 });
        expect(handle).toMatchObject({ name: 'rules_1', rowCount: 0, columns: [], truncated: false });
        expect(engine.executed).toContain('CREATE TABLE "rules_1" AS SELECT NULL::VARCHAR AS _empty WHERE false');
    });

    it('replaces a table when an exact name is given', async () => {
        const { engine, store } = setup();
        await store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
        const refreshed = await store.ingestRows('rules', provenance, rowsOf([{ i: 1 }, { i: 2 }]), { rowCap: 10, name: 'rules_1' });
        expect(refreshed.name).toBe('rules_1');
        expect(engine.tables.get('rules_1')).toEqual([{ i: 1 }, { i: 2 }]);
        expect(store.listHandles().map(handle => handle.name)).toEqual(['rules_1']);
        const next = await store.ingestRows('rules', provenance, rowsOf([{ i: 3 }]), { rowCap: 10 });
        expect(next.name).toBe('rules_2');
    });

    it('rejects an invalid exact name', async () => {
        const { store } = setup();
        await expect(store.ingestRows('rules', provenance, rowsOf([]), { rowCap: 10, name: 'Bad Name' })).rejects.toBeInstanceOf(
            DataHandleStoreError,
        );
    });

    it('rejects with an AbortError and registers nothing when aborted', async () => {
        const { store } = setup();
        const controller = new AbortController();
        async function* source() {
            yield { i: 0 };
            controller.abort();
            yield { i: 1 };
        }
        await expect(store.ingestRows('rules', provenance, source(), { rowCap: 10, signal: controller.signal })).rejects.toMatchObject({
            name: 'AbortError',
        });
        expect(store.listHandles()).toEqual([]);
    });

    it('reports an unavailable engine and retries on the next call', async () => {
        const engine = new FakeDuckDbEngine();
        const factory = jest.fn().mockRejectedValueOnce(new Error('wasm blocked')).mockResolvedValue(engine);
        const store = new DuckDbDataHandleStore(factory);
        await expect(store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 })).rejects.toMatchObject({
            code: 'unavailable',
            message: 'The SQL scratchpad could not start: wasm blocked',
        });
        await expect(store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 })).resolves.toMatchObject({ rowCount: 1 });
        expect(factory).toHaveBeenCalledTimes(2);
    });
});

describe('DuckDbDataHandleStore.query', () => {
    it('returns at most maxRows rows and the total count', async () => {
        const { engine, store } = setup();
        await store.ingestRows('rules', provenance, rowsOf([{ i: 0 }, { i: 1 }, { i: 2 }]), { rowCap: 10 });
        const result = await store.query('SELECT * FROM rules_1;', { maxRows: 2 });
        expect(result).toEqual({ columns: ['i'], rows: [{ i: 0 }, { i: 1 }], totalRows: 3 });
        expect(engine.executed).toContain('SELECT count(*) AS n FROM (SELECT * FROM rules_1) AS _q');
        expect(engine.executed).toContain('SELECT * FROM (SELECT * FROM rules_1) AS _q LIMIT 2');
    });

    it('rejects anything but one SELECT or WITH statement before touching DuckDB', async () => {
        const { factory, store } = setup();
        await expect(store.query('DROP TABLE rules_1', { maxRows: 10 })).rejects.toMatchObject({ code: 'invalid_sql' });
        await expect(store.query("SELECT 1; COPY rules_1 TO 'x.csv'", { maxRows: 10 })).rejects.toMatchObject({ code: 'invalid_sql' });
        expect(factory).not.toHaveBeenCalled();
    });

    it('saves a result as a new handle with run_sql provenance', async () => {
        const { engine, store } = setup();
        await store.ingestRows('rules', provenance, rowsOf([{ i: 0 }, { i: 1 }]), { rowCap: 10 });
        const result = await store.query('SELECT * FROM rules_1', { maxRows: 1, saveAs: 'subset' });
        expect(result).toEqual({ columns: ['i'], rows: [{ i: 0 }], totalRows: 2, savedAs: 'subset' });
        expect(engine.tables.get('subset')).toEqual([{ i: 0 }, { i: 1 }]);
        expect(store.listHandles().find(handle => handle.name === 'subset')).toEqual({
            name: 'subset',
            provenance: { toolName: 'run_sql', args: { sql: 'SELECT * FROM rules_1', save_as: 'subset' }, fetchedAt: '2026-10-25T12:00:00.000Z' },
            rowCount: 2,
            truncated: false,
            columns: [{ name: 'i', type: 'DOUBLE' }],
            status: 'live',
        });
    });

    it('refuses to overwrite fetched data or use an invalid name with save_as', async () => {
        const { store } = setup();
        await store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
        await expect(store.query('SELECT * FROM rules_1', { maxRows: 1, saveAs: 'rules_1' })).rejects.toMatchObject({ code: 'invalid_name' });
        await expect(store.query('SELECT * FROM rules_1', { maxRows: 1, saveAs: 'My Table' })).rejects.toMatchObject({ code: 'invalid_name' });
    });

    it('lets a saved query be saved again under the same name', async () => {
        const { store } = setup();
        await store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
        await store.query('SELECT * FROM rules_1', { maxRows: 1, saveAs: 'subset' });
        await expect(store.query('SELECT * FROM rules_1', { maxRows: 1, saveAs: 'subset' })).resolves.toMatchObject({ savedAs: 'subset' });
    });

    it('never lets a hidden second statement reach the engine outside the FROM ( ) wrapper', async () => {
        const { engine, store } = setup();
        await store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
        const hidden = 'SELECT 1 /* ; */ ; DROP TABLE rules_1';
        await expect(store.query(hidden, { maxRows: 1, saveAs: 'subset' })).rejects.toMatchObject({ code: 'invalid_sql' });
        await expect(store.query(hidden, { maxRows: 1 })).rejects.toMatchObject({ code: 'invalid_sql' });
        expect(engine.executed.some(sql => sql.includes('DROP TABLE rules_1'))).toBe(false);
        expect(engine.tables.has('rules_1')).toBe(true);
        await store.query('SELECT * FROM rules_1;', { maxRows: 1, saveAs: 'subset' });
        expect(engine.executed).toContain('CREATE OR REPLACE TABLE "subset" AS SELECT * FROM (SELECT * FROM rules_1) AS _q');
    });

    it('passes DuckDB errors through', async () => {
        const { store } = setup();
        await expect(store.query('SELECT * FROM rules_9', { maxRows: 1 })).rejects.toThrow('Table with name rules_9 does not exist');
    });
});

describe('DuckDbDataHandleStore lifecycle', () => {
    it('drops every handle on dropAll and restarts numbering', async () => {
        const { engine, store } = setup();
        const listener = jest.fn();
        store.subscribe(listener);
        await store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
        await store.ingestRows('rses', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
        listener.mockClear();

        await store.dropAll();

        expect(store.listHandles()).toEqual([]);
        expect(engine.tables.size).toBe(0);
        expect(engine.executed).toEqual(expect.arrayContaining(['DROP TABLE IF EXISTS "rules_1"', 'DROP TABLE IF EXISTS "rses_1"']));
        expect(listener).toHaveBeenCalled();
        const next = await store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
        expect(next.name).toBe('rules_1');
    });

    it('drops a single handle', async () => {
        const { engine, store } = setup();
        await store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
        await store.drop('rules_1');
        expect(store.listHandles()).toEqual([]);
        expect(engine.tables.has('rules_1')).toBe(false);
    });

    it('keeps the same listHandles array until something changes', async () => {
        const { store } = setup();
        const before = store.listHandles();
        expect(store.listHandles()).toBe(before);
        await store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
        const after = store.listHandles();
        expect(after).not.toBe(before);
        expect(store.listHandles()).toBe(after);
    });

    it('reports zero memory without starting DuckDB, then the engine figure', async () => {
        const { factory, store } = setup();
        await expect(store.memoryBytes()).resolves.toBe(0);
        expect(factory).not.toHaveBeenCalled();
        await store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
        await expect(store.memoryBytes()).resolves.toBe(4096);
    });

    it('terminates the engine after ten idle minutes and forgets every handle', async () => {
        jest.useFakeTimers();
        try {
            const { engine, store } = setup();
            await store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
            await jest.advanceTimersByTimeAsync(DEFAULT_IDLE_MS - 1000);
            await store.query('SELECT * FROM rules_1', { maxRows: 1 });
            await jest.advanceTimersByTimeAsync(DEFAULT_IDLE_MS - 1000);
            expect(engine.terminated).toBe(false);
            await jest.advanceTimersByTimeAsync(1000);
            expect(engine.terminated).toBe(true);
            expect(store.listHandles()).toEqual([]);
        } finally {
            jest.useRealTimers();
        }
    });

    it('starts a fresh engine after terminate', async () => {
        const engines = [new FakeDuckDbEngine(), new FakeDuckDbEngine()];
        const factory: jest.Mock<Promise<DuckDbEngine>, []> = jest.fn(async () => engines[factory.mock.calls.length - 1]);
        const store = new DuckDbDataHandleStore(factory);
        await store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
        await store.terminate();
        expect(engines[0].terminated).toBe(true);
        const handle = await store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
        expect(handle.name).toBe('rules_1');
        expect(factory).toHaveBeenCalledTimes(2);
    });
});

function gate() {
    let release!: () => void;
    const promise = new Promise<void>(resolve => {
        release = resolve;
    });
    return { promise, release };
}

describe('DuckDbDataHandleStore concurrency and lifecycle', () => {
    it('does not run a queued ingest that was aborted while waiting', async () => {
        const { engine, store } = setup();
        const held = gate();
        engine.insertGate = held.promise;
        const first = store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
        await new Promise(resolve => setTimeout(resolve, 0));
        const controller = new AbortController();
        const second = store.ingestRows('rses', provenance, rowsOf([{ i: 1 }]), { rowCap: 10, signal: controller.signal });
        const secondResult = expect(second).rejects.toMatchObject({ name: 'AbortError' });
        await new Promise(resolve => setTimeout(resolve, 0));
        controller.abort();
        engine.insertGate = undefined;
        held.release();
        await first;
        await secondResult;
        expect(engine.executed).not.toContain('DROP TABLE IF EXISTS "rses_1"');
        expect(engine.executed).not.toContain('INSERT JSON rses_1');
        expect(store.listHandles().map(handle => handle.name)).toEqual(['rules_1']);
    });

    it('does not run a queued save_as that was aborted while waiting', async () => {
        const { engine, store } = setup();
        await store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
        const held = gate();
        engine.insertGate = held.promise;
        const blocker = store.ingestRows('rses', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
        await new Promise(resolve => setTimeout(resolve, 0));
        const controller = new AbortController();
        const saved = store.query('SELECT * FROM rules_1', { maxRows: 1, saveAs: 'subset', signal: controller.signal });
        const savedResult = expect(saved).rejects.toMatchObject({ name: 'AbortError' });
        await new Promise(resolve => setTimeout(resolve, 0));
        controller.abort();
        engine.insertGate = undefined;
        held.release();
        await blocker;
        await savedResult;
        expect(engine.executed.some(sql => sql.startsWith('CREATE OR REPLACE TABLE "subset"'))).toBe(false);
        expect(store.listHandles().some(handle => handle.name === 'subset')).toBe(false);
    });

    it.each(['dropAll', 'terminate'] as const)('does not register a handle whose ingest was in flight during %s', async method => {
        const { engine, store } = setup();
        const listener = jest.fn();
        store.subscribe(listener);
        const held = gate();
        engine.insertGate = held.promise;
        const ingest = store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
        const ingestResult = expect(ingest).rejects.toMatchObject({ name: 'AbortError' });
        await new Promise(resolve => setTimeout(resolve, 0));
        const dropping = store[method]();
        listener.mockClear();
        engine.insertGate = undefined;
        held.release();
        await dropping;
        await ingestResult;
        expect(store.listHandles()).toEqual([]);
        expect(listener).not.toHaveBeenCalled();
        if (method === 'dropAll') expect(engine.tables.has('rules_1')).toBe(false);
    });

    it('re-checks the save_as name against fetched data when the queued work runs', async () => {
        const { engine, store } = setup();
        const held = gate();
        engine.insertGate = held.promise;
        const ingest = store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
        await new Promise(resolve => setTimeout(resolve, 0));
        engine.statementResults.set('SELECT 1', [{ x: 1 }]);
        const saved = store.query('SELECT 1', { maxRows: 1, saveAs: 'rules_1' });
        const savedResult = expect(saved).rejects.toMatchObject({ code: 'invalid_name' });
        await new Promise(resolve => setTimeout(resolve, 0));
        engine.insertGate = undefined;
        held.release();
        await ingest;
        await savedResult;
        expect(engine.tables.get('rules_1')).toEqual([{ i: 0 }]);
        expect(store.listHandles()[0].provenance).toEqual(provenance);
    });

    it('removes the old handle when a refresh fails to insert, and notifies', async () => {
        const { engine, store } = setup();
        await store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
        const listener = jest.fn();
        store.subscribe(listener);
        engine.failInsert = new Error('insert failed');
        await expect(store.ingestRows('rules', provenance, rowsOf([{ i: 1 }]), { rowCap: 10, name: 'rules_1' })).rejects.toThrow('insert failed');
        expect(store.listHandles()).toEqual([]);
        expect(engine.tables.has('rules_1')).toBe(false);
        expect(listener).toHaveBeenCalled();
    });

    it('drops a partly created table and registers nothing when a new ingest fails', async () => {
        const { engine, store } = setup();
        engine.failInsert = new Error('insert failed');
        await expect(store.ingestRows('rules', provenance, rowsOf([{ i: 1 }]), { rowCap: 10 })).rejects.toThrow('insert failed');
        expect(store.listHandles()).toEqual([]);
        expect(engine.executed.filter(sql => sql === 'DROP TABLE IF EXISTS "rules_1"').length).toBeGreaterThanOrEqual(2);
    });

    it('rejects drop with an invalid name before sending SQL', async () => {
        const { engine, store } = setup();
        await store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
        const before = engine.executed.length;
        await expect(store.drop('x"; DROP TABLE rules_1; --')).rejects.toMatchObject({ code: 'invalid_name' });
        expect(engine.executed).toHaveLength(before);
    });

    it('falls back to defaults for bad numeric options and floors fractions', async () => {
        const { engine, store } = setup();
        const handle = await store.ingestRows('rules', provenance, rowsOf([{ i: 0 }, { i: 1 }]), { rowCap: Number.NaN });
        expect(handle.rowCount).toBe(2);
        const negative = await store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: -5 });
        expect(negative.rowCount).toBe(1);
        await store.query('SELECT * FROM rules_1', { maxRows: Number.POSITIVE_INFINITY });
        await store.query('SELECT * FROM rules_1', { maxRows: 1.9 });
        const limits = engine.executed.filter(sql => sql.includes(' LIMIT ')).map(sql => sql.split(' LIMIT ')[1]);
        expect(limits).toEqual([String(DEFAULT_MAX_ROWS), '1']);
    });

    it('runs memoryBytes through the queue without re-arming the idle timer', async () => {
        jest.useFakeTimers();
        try {
            const { engine, store } = setup();
            await store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
            const held = gate();
            engine.insertGate = held.promise;
            const ingest = store.ingestRows('rses', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
            await jest.advanceTimersByTimeAsync(0);
            let memory: number | undefined;
            const pending = store.memoryBytes().then(value => {
                memory = value;
            });
            await jest.advanceTimersByTimeAsync(0);
            expect(memory).toBeUndefined();
            engine.insertGate = undefined;
            held.release();
            await ingest;
            await pending;
            expect(memory).toBe(4096);
            await jest.advanceTimersByTimeAsync(DEFAULT_IDLE_MS - 1);
            await store.memoryBytes();
            await jest.advanceTimersByTimeAsync(1);
            expect(engine.terminated).toBe(true);
        } finally {
            jest.useRealTimers();
        }
    });

    it('notifies subscribers until they unsubscribe', async () => {
        const { store } = setup();
        const listener = jest.fn();
        const unsubscribe = store.subscribe(listener);
        await store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
        expect(listener).toHaveBeenCalledTimes(1);
        unsubscribe();
        await store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('removes the old handle when a refresh is aborted after replacing the table', async () => {
        const { engine, store } = setup();
        await store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
        const controller = new AbortController();
        const held = gate();
        engine.insertGate = held.promise;
        const refresh = store.ingestRows('rules', provenance, rowsOf([{ i: 1 }]), { rowCap: 10, name: 'rules_1', signal: controller.signal });
        const refreshResult = expect(refresh).rejects.toMatchObject({ name: 'AbortError' });
        await new Promise(resolve => setTimeout(resolve, 0));
        controller.abort();
        engine.insertGate = undefined;
        held.release();
        await refreshResult;
        expect(store.listHandles()).toEqual([]);
        expect(engine.tables.has('rules_1')).toBe(false);
    });

    it('removes an existing saved handle when save_as fails after replacing its table', async () => {
        const { engine, store } = setup();
        await store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
        await store.query('SELECT * FROM rules_1', { maxRows: 1, saveAs: 'subset' });
        const controller = new AbortController();
        const realQuery = engine.query.bind(engine);
        engine.query = async (sql, signal) => {
            if (sql === 'SELECT count(*) AS n FROM "subset"') controller.abort();
            return realQuery(sql, signal);
        };
        await expect(store.query('SELECT * FROM rules_1', { maxRows: 1, saveAs: 'subset', signal: controller.signal })).rejects.toMatchObject({
            name: 'AbortError',
        });
        expect(store.listHandles().map(handle => handle.name)).toEqual(['rules_1']);
        expect(engine.tables.has('subset')).toBe(false);
    });

    it('does not terminate the engine while an ingest is still reading a slow source', async () => {
        jest.useFakeTimers();
        try {
            const { engine, store } = setup();
            await store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
            const held = gate();
            async function* slow() {
                await held.promise;
                yield { i: 1 };
            }
            const ingest = store.ingestRows('rses', provenance, slow(), { rowCap: 10 });
            await jest.advanceTimersByTimeAsync(DEFAULT_IDLE_MS + 1000);
            expect(engine.terminated).toBe(false);
            held.release();
            await expect(ingest).resolves.toMatchObject({ name: 'rses_1' });
            expect(store.listHandles().map(handle => handle.name)).toEqual(['rules_1', 'rses_1']);
            await jest.advanceTimersByTimeAsync(DEFAULT_IDLE_MS);
            expect(engine.terminated).toBe(true);
        } finally {
            jest.useRealTimers();
        }
    });

    it('rejects stale queued work without booting a fresh engine', async () => {
        const { engine, factory, store } = setup();
        const held = gate();
        engine.insertGate = held.promise;
        const first = store.ingestRows('rules', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
        const firstResult = expect(first).rejects.toMatchObject({ name: 'AbortError' });
        await new Promise(resolve => setTimeout(resolve, 0));
        const second = store.ingestRows('rses', provenance, rowsOf([{ i: 0 }]), { rowCap: 10 });
        const secondResult = expect(second).rejects.toMatchObject({ name: 'AbortError' });
        await new Promise(resolve => setTimeout(resolve, 0));
        const terminating = store.terminate();
        engine.insertGate = undefined;
        held.release();
        await terminating;
        await firstResult;
        await secondResult;
        expect(factory).toHaveBeenCalledTimes(1);
    });
});
