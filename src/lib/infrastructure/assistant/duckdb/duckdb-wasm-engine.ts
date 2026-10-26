import type { DuckDbEngine, DuckDbQueryResult } from './duckdb-engine';
import { arrowTableToRows, type ArrowLikeTable } from './arrow-rows';
import { abortError } from '../abort';

export const DUCKDB_ASSET_PATH = '/duckdb/';
export const STARTUP_TIMEOUT_MS = 30_000;
/** How long a cancelled query may keep running before the worker is terminated. */
export const ABORT_GRACE_MS = 2000;

const START_ERROR = 'The SQL scratchpad could not start';

interface WorkerLike {
    addEventListener(type: string, listener: (event: unknown) => void): void;
    removeEventListener(type: string, listener: (event: unknown) => void): void;
    terminate(): void;
}

interface ConnLike {
    query(sql: string): Promise<unknown>;
    cancelSent(): Promise<unknown>;
    close(): Promise<unknown>;
    insertJSONFromPath(file: string, options: { name: string }): Promise<unknown>;
}

interface DbLike {
    instantiate(mainModule: string, pthreadWorker?: string | null): Promise<unknown>;
    open(config: Record<string, unknown>): Promise<unknown>;
    connect(): Promise<ConnLike>;
    terminate(): Promise<unknown>;
    registerFileText(name: string, text: string): Promise<unknown>;
    dropFile(name: string): Promise<unknown>;
}

interface DuckDbModuleLike {
    selectBundle(bundles: Record<string, { mainModule: string; mainWorker: string }>): Promise<{
        mainModule: string;
        mainWorker: string | null;
        pthreadWorker?: string | null;
    }>;
    VoidLogger: new () => unknown;
    AsyncDuckDB: new (logger: never, worker: never) => DbLike;
}

/** Injection points so tests can drive the engine without a browser. Defaults are the real ones. */
export interface DuckDbWasmEngineDeps {
    loadModule?: () => Promise<DuckDbModuleLike>;
    createWorker?: (url: string) => WorkerLike;
    assetBase?: string;
    startupTimeoutMs?: number;
    abortGraceMs?: number;
    /** Called when the engine terminated itself (a cancelled query would not stop), so the owner can forget it. */
    onTerminated?: (engine: DuckDbEngine) => void;
}

export async function createDuckDbWasmEngine(deps: DuckDbWasmEngineDeps = {}): Promise<DuckDbEngine> {
    if (!deps.createWorker && (typeof window === 'undefined' || typeof Worker === 'undefined')) {
        throw new Error('The SQL scratchpad needs a browser with Web Worker support');
    }
    const duckdb = await (deps.loadModule ?? (() => import('@duckdb/duckdb-wasm') as unknown as Promise<DuckDbModuleLike>))();
    const base = deps.assetBase ?? new URL(DUCKDB_ASSET_PATH, window.location.origin).href;
    const bundle = await duckdb.selectBundle({
        mvp: { mainModule: `${base}duckdb-mvp.wasm`, mainWorker: `${base}duckdb-browser-mvp.worker.js` },
        eh: { mainModule: `${base}duckdb-eh.wasm`, mainWorker: `${base}duckdb-browser-eh.worker.js` },
    });
    if (!bundle.mainWorker) throw new Error('No DuckDB worker bundle is available');
    const worker = deps.createWorker ? deps.createWorker(bundle.mainWorker) : (new Worker(bundle.mainWorker) as unknown as WorkerLike);
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger() as never, worker as never);

    // A worker script that fails to load (for example a redirect to the login page) never answers, so race startup
    // against the worker's own failure events and a timeout.
    let failStartup: (error: Error) => void = () => undefined;
    const startupFailure = new Promise<never>((_, reject) => {
        failStartup = reject;
    });
    const onWorkerError = () => failStartup(new Error(START_ERROR));
    worker.addEventListener('error', onWorkerError);
    worker.addEventListener('messageerror', onWorkerError);
    const timer = setTimeout(() => failStartup(new Error(START_ERROR)), deps.startupTimeoutMs ?? STARTUP_TIMEOUT_MS);
    let conn: ConnLike;
    try {
        conn = await Promise.race([
            (async () => {
                await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
                await db.open({ query: { castBigIntToDouble: true, castDecimalToDouble: true } });
                return db.connect();
            })(),
            startupFailure,
        ]);
    } catch (error) {
        worker.terminate();
        void db.terminate().catch(() => undefined);
        throw error instanceof Error && error.message === START_ERROR ? error : new Error(START_ERROR);
    } finally {
        clearTimeout(timer);
        worker.removeEventListener('error', onWorkerError);
        worker.removeEventListener('messageerror', onWorkerError);
    }

    let fileSeq = 0;
    let dead = false;
    const inflight = new Set<(error: Error) => void>();

    const terminate = async (): Promise<void> => {
        if (dead) return;
        dead = true;
        // Terminate the worker first: it is the only thing that stops a running call. duckdb-wasm leaves its pending
        // requests unsettled afterwards, so reject every in-flight call ourselves.
        worker.removeEventListener('error', onCrash);
        worker.removeEventListener('messageerror', onCrash);
        worker.terminate();
        inflight.forEach(reject => reject(abortError()));
        inflight.clear();
        void conn.close().catch(() => undefined);
        await db.terminate().catch(() => undefined);
    };

    // The engine ended without being asked to (worker crash, or a call that would not stop): tell the owner.
    const killAndNotify = async (): Promise<void> => {
        if (dead) return;
        await terminate();
        deps.onTerminated?.(engine);
    };

    function onCrash(): void {
        void killAndNotify();
    }
    worker.addEventListener('error', onCrash);
    worker.addEventListener('messageerror', onCrash);

    /** Runs one engine call. It settles on its own result, on abort escalation, or when the engine is terminated. */
    const track = <T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
        if (dead || signal?.aborted) return Promise.reject(abortError());
        return new Promise<T>((resolve, reject) => {
            let settled = false;
            let graceTimer: ReturnType<typeof setTimeout> | undefined;
            const finish = (settle: () => void) => {
                if (settled) return;
                settled = true;
                if (graceTimer !== undefined) clearTimeout(graceTimer);
                signal?.removeEventListener('abort', onAbort);
                inflight.delete(fail);
                settle();
            };
            const fail = (error: Error) => finish(() => reject(error));
            const onAbort = () => {
                try {
                    void Promise.resolve(conn.cancelSent()).catch(() => undefined);
                } catch {
                    // Cancellation is best effort; the grace timer below still ends the call.
                }
                graceTimer = setTimeout(() => {
                    fail(abortError());
                    void killAndNotify();
                }, deps.abortGraceMs ?? ABORT_GRACE_MS);
            };
            inflight.add(fail);
            signal?.addEventListener('abort', onAbort, { once: true });
            run().then(
                value => finish(() => (signal?.aborted ? reject(abortError()) : resolve(value))),
                error => fail(error),
            );
        });
    };

    const engine: DuckDbEngine = {
        exec: (sql, signal) => track(async () => void (await conn.query(sql)), signal),
        query: (sql, signal) => track<DuckDbQueryResult>(async () => arrowTableToRows((await conn.query(sql)) as unknown as ArrowLikeTable), signal),
        insertJSON: (table, jsonText, signal) =>
            track(async () => {
                fileSeq += 1;
                const file = `rucio_ingest_${fileSeq}.json`;
                await db.registerFileText(file, jsonText);
                try {
                    await conn.insertJSONFromPath(file, { name: table });
                } finally {
                    await db.dropFile(file).catch(() => undefined);
                }
            }, signal),
        terminate,
    };
    return engine;
}
