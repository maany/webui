import { createDuckDbWasmEngine, type DuckDbWasmEngineDeps } from '@/lib/infrastructure/assistant/duckdb/duckdb-wasm-engine';
import { DuckDbDataHandleStore } from '@/lib/infrastructure/assistant/duckdb/duckdb-data-handle-store';
import { rowsOf } from 'test/fixtures/assistant/fake-duckdb-engine';

class FakeWorker {
    listeners = new Map<string, Array<(event: unknown) => void>>();
    terminate = jest.fn();
    addEventListener(type: string, listener: (event: unknown) => void) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    removeEventListener(type: string, listener: (event: unknown) => void) {
        this.listeners.set(
            type,
            (this.listeners.get(type) ?? []).filter(l => l !== listener),
        );
    }
    emit(type: string) {
        (this.listeners.get(type) ?? []).forEach(l => l({ type, message: 'boom' }));
    }
}

class FakeConn {
    query = jest.fn(async (_sql: string): Promise<unknown> => ({ schema: { fields: [] }, toArray: () => [] }));
    cancelSent = jest.fn(async () => true);
    close = jest.fn(async () => undefined);
    insertJSONFromPath = jest.fn(async () => undefined);
}

class FakeDb {
    conn = new FakeConn();
    instantiate = jest.fn(async () => undefined);
    open = jest.fn(async () => undefined);
    connect = jest.fn(async () => this.conn);
    terminate = jest.fn(async () => undefined);
    registerFileText = jest.fn(async () => undefined);
    dropFile = jest.fn(async () => undefined);
}

function setup(configure?: (db: FakeDb, worker: FakeWorker) => void, extra: Partial<DuckDbWasmEngineDeps> = {}) {
    const worker = new FakeWorker();
    const db = new FakeDb();
    configure?.(db, worker);
    const deps: DuckDbWasmEngineDeps = {
        assetBase: 'http://localhost/duckdb/',
        createWorker: () => worker as never,
        loadModule: async () =>
            ({
                selectBundle: async () => ({ mainModule: 'm.wasm', mainWorker: 'w.js', pthreadWorker: null }),
                VoidLogger: class {},
                AsyncDuckDB: function () {
                    return db;
                },
            } as never),
        ...extra,
    };
    return { worker, db, deps };
}

const never = () => new Promise<never>(() => undefined);

describe('createDuckDbWasmEngine startup', () => {
    afterEach(() => jest.useRealTimers());

    it('rejects promptly and terminates the worker when the worker script fails to load', async () => {
        const { worker, deps } = setup(db => {
            db.instantiate.mockImplementation(never);
        });
        const started = createDuckDbWasmEngine(deps);
        const outcome = expect(started).rejects.toThrow('The SQL scratchpad could not start');
        await new Promise(resolve => setTimeout(resolve, 0));
        worker.emit('error');
        await outcome;
        expect(worker.terminate).toHaveBeenCalled();
    });

    it('rejects on messageerror too', async () => {
        const { worker, deps } = setup(db => {
            db.instantiate.mockImplementation(never);
        });
        const started = createDuckDbWasmEngine(deps);
        const outcome = expect(started).rejects.toThrow('could not start');
        await new Promise(resolve => setTimeout(resolve, 0));
        worker.emit('messageerror');
        await outcome;
    });

    it('times out when instantiate never settles', async () => {
        jest.useFakeTimers();
        const { worker, deps } = setup(db => {
            db.instantiate.mockImplementation(never);
        });
        const started = createDuckDbWasmEngine(deps);
        const outcome = expect(started).rejects.toThrow('could not start');
        await jest.advanceTimersByTimeAsync(30_000);
        await outcome;
        expect(worker.terminate).toHaveBeenCalled();
    });

    it('terminates the worker when connect fails', async () => {
        const { worker, deps } = setup(db => {
            db.connect.mockRejectedValue(new Error('no connection'));
        });
        await expect(createDuckDbWasmEngine(deps)).rejects.toThrow('could not start');
        expect(worker.terminate).toHaveBeenCalled();
    });

    it('lets the store report unavailable and retry on the next call', async () => {
        const first = setup(db => {
            db.instantiate.mockImplementation(never);
        });
        const second = setup();
        const decks = [first, second];
        let call = 0;
        const store = new DuckDbDataHandleStore(async () => createDuckDbWasmEngine(decks[call++].deps));
        const provenance = { toolName: 'list_rules', args: {}, fetchedAt: '2026-10-25T10:00:00.000Z' };
        const failing = expect(store.ingestRows('rules', provenance, rowsOf([{ i: 1 }]), { rowCap: 10 })).rejects.toMatchObject({
            code: 'unavailable',
            message: 'The SQL scratchpad could not start',
        });
        await new Promise(resolve => setTimeout(resolve, 0));
        first.worker.emit('error');
        await failing;
        await expect(store.ingestRows('rules', provenance, rowsOf([{ i: 1 }]), { rowCap: 10 })).resolves.toBeDefined();
        expect(call).toBe(2);
    });
});

describe('createDuckDbWasmEngine abort and terminate', () => {
    afterEach(() => jest.useRealTimers());

    it('terminates the worker 2 s after an abort that the running query ignores', async () => {
        jest.useFakeTimers();
        const onTerminated = jest.fn();
        const { worker, db, deps } = setup(undefined, { onTerminated });
        const engine = await createDuckDbWasmEngine(deps);
        db.conn.query.mockImplementation(never);
        const controller = new AbortController();
        const running = engine.query('SELECT 1', controller.signal);
        const outcome = expect(running).rejects.toMatchObject({ name: 'AbortError' });
        controller.abort();
        expect(db.conn.cancelSent).toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1999);
        expect(worker.terminate).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1);
        await outcome;
        expect(worker.terminate).toHaveBeenCalled();
        expect(onTerminated).toHaveBeenCalledTimes(1);
    });

    it('keeps the worker when the cancelled query settles within the grace period', async () => {
        jest.useFakeTimers();
        const { worker, db, deps } = setup();
        const engine = await createDuckDbWasmEngine(deps);
        let fail: (error: Error) => void = () => undefined;
        db.conn.query.mockImplementation(() => new Promise((_, reject) => (fail = reject)));
        const controller = new AbortController();
        const running = engine.query('SELECT 1', controller.signal);
        const outcome = expect(running).rejects.toThrow('INTERRUPT');
        controller.abort();
        fail(new Error('INTERRUPT'));
        await outcome;
        await jest.advanceTimersByTimeAsync(5000);
        expect(worker.terminate).not.toHaveBeenCalled();
    });

    it('terminate() stops a running query immediately without waiting for close', async () => {
        const { worker, db, deps } = setup();
        const engine = await createDuckDbWasmEngine(deps);
        db.conn.query.mockImplementation(never);
        db.conn.close.mockImplementation(never);
        const running = engine.query('SELECT 1');
        const outcome = expect(running).rejects.toMatchObject({ name: 'AbortError' });
        const done = engine.terminate();
        expect(worker.terminate).toHaveBeenCalled();
        await done;
        await outcome;
        expect(db.terminate).toHaveBeenCalled();
    });
});

describe('createDuckDbWasmEngine tracks every call', () => {
    afterEach(() => jest.useRealTimers());

    it('terminate() rejects a never-settling exec', async () => {
        const { db, deps } = setup();
        const engine = await createDuckDbWasmEngine(deps);
        db.conn.query.mockImplementation(never);
        const outcome = expect(engine.exec('CREATE TABLE t AS SELECT 1')).rejects.toMatchObject({ name: 'AbortError' });
        await engine.terminate();
        await outcome;
    });

    it('terminate() rejects a never-settling insertJSON', async () => {
        const { db, deps } = setup();
        const engine = await createDuckDbWasmEngine(deps);
        db.conn.insertJSONFromPath.mockImplementation(never);
        const outcome = expect(engine.insertJSON('t', '[]')).rejects.toMatchObject({ name: 'AbortError' });
        await engine.terminate();
        await outcome;
    });

    it('escalates an aborted exec after 2 s', async () => {
        jest.useFakeTimers();
        const onTerminated = jest.fn();
        const { worker, db, deps } = setup(undefined, { onTerminated });
        const engine = await createDuckDbWasmEngine(deps);
        db.conn.query.mockImplementation(never);
        const controller = new AbortController();
        const outcome = expect(engine.exec('CREATE TABLE t AS SELECT 1', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
        controller.abort();
        await jest.advanceTimersByTimeAsync(2000);
        await outcome;
        expect(worker.terminate).toHaveBeenCalled();
        expect(onTerminated).toHaveBeenCalledWith(engine);
    });

    it('escalates an aborted insertJSON after 2 s', async () => {
        jest.useFakeTimers();
        const { worker, db, deps } = setup();
        const engine = await createDuckDbWasmEngine(deps);
        db.conn.insertJSONFromPath.mockImplementation(never);
        const controller = new AbortController();
        const outcome = expect(engine.insertJSON('t', '[]', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
        controller.abort();
        await jest.advanceTimersByTimeAsync(2000);
        await outcome;
        expect(worker.terminate).toHaveBeenCalled();
    });

    it('treats a worker error after start as a crash: rejects in-flight calls and reports termination', async () => {
        const onTerminated = jest.fn();
        const { worker, db, deps } = setup(undefined, { onTerminated });
        const engine = await createDuckDbWasmEngine(deps);
        db.conn.query.mockImplementation(never);
        const outcome = expect(engine.query('SELECT 1')).rejects.toMatchObject({ name: 'AbortError' });
        worker.emit('error');
        await outcome;
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(onTerminated).toHaveBeenCalledWith(engine);
        await expect(engine.exec('SELECT 1')).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('store: a terminated engine does not block the chain, the next call starts a fresh engine', async () => {
        const first = setup();
        const second = setup();
        const decks = [first, second];
        let call = 0;
        const store: DuckDbDataHandleStore = new DuckDbDataHandleStore(async () =>
            createDuckDbWasmEngine({ ...decks[call++].deps, onTerminated: dead => void store.terminateEngine(dead) }),
        );
        const provenance = { toolName: 'list_rules', args: {}, fetchedAt: '2026-10-25T10:00:00.000Z' };
        await store.ingestRows('rules', provenance, rowsOf([{ i: 1 }]), { rowCap: 10 });
        first.db.conn.insertJSONFromPath.mockImplementation(never);
        const hung = expect(store.ingestRows('rules', provenance, rowsOf([{ i: 1 }]), { rowCap: 10 })).rejects.toMatchObject({
            name: 'AbortError',
        });
        await new Promise(resolve => setTimeout(resolve, 0));
        first.worker.emit('error');
        await hung;
        await expect(store.ingestRows('rules', provenance, rowsOf([{ i: 1 }]), { rowCap: 10 })).resolves.toBeDefined();
        expect(call).toBe(2);
    });

    it('store: an aborted save_as that hangs rejects within 2 s, handles expire, the next call works', async () => {
        jest.useFakeTimers();
        const first = setup();
        const second = setup();
        const decks = [first, second];
        let call = 0;
        const store: DuckDbDataHandleStore = new DuckDbDataHandleStore(async () => {
            const index = call++;
            const engine = await createDuckDbWasmEngine({ ...decks[index].deps, onTerminated: dead => void store.terminateEngine(dead) });
            return engine;
        });
        const provenance = { toolName: 'list_rules', args: {}, fetchedAt: '2026-10-25T10:00:00.000Z' };
        await store.ingestRows('rules', provenance, rowsOf([{ i: 1 }]), { rowCap: 10 });
        expect(store.listHandles()).toHaveLength(1);
        first.db.conn.query.mockImplementation(never);
        const controller = new AbortController();
        const outcome = expect(
            store.query('SELECT * FROM rules_1', { maxRows: 5, saveAs: 'saved', signal: controller.signal }),
        ).rejects.toMatchObject({
            name: 'AbortError',
        });
        await jest.advanceTimersByTimeAsync(10);
        controller.abort();
        await jest.advanceTimersByTimeAsync(2000);
        await outcome;
        expect(first.worker.terminate).toHaveBeenCalled();
        expect(store.listHandles()).toEqual([]);
        await expect(store.ingestRows('rules', provenance, rowsOf([{ i: 1 }]), { rowCap: 10 })).resolves.toBeDefined();
        expect(call).toBe(2);
    });

    it('store.terminateEngine ignores an engine that is no longer current', async () => {
        const first = setup();
        const second = setup();
        const decks = [first, second];
        let call = 0;
        const engines: Awaited<ReturnType<typeof createDuckDbWasmEngine>>[] = [];
        const store = new DuckDbDataHandleStore(async () => {
            const engine = await createDuckDbWasmEngine(decks[call++].deps);
            engines.push(engine);
            return engine;
        });
        const provenance = { toolName: 'list_rules', args: {}, fetchedAt: '2026-10-25T10:00:00.000Z' };
        await store.ingestRows('a', provenance, rowsOf([{ i: 1 }]), { rowCap: 10 });
        await store.terminate();
        await store.ingestRows('b', provenance, rowsOf([{ i: 1 }]), { rowCap: 10 });
        await store.terminateEngine(engines[0]);
        expect(second.worker.terminate).not.toHaveBeenCalled();
        expect(store.listHandles()).toHaveLength(1);
    });
});
