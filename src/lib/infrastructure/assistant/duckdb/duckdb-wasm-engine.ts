import type { DuckDbEngine, DuckDbQueryResult } from './duckdb-engine';
import { arrowTableToRows, type ArrowLikeTable } from './arrow-rows';
import { abortError } from '../abort';

export const DUCKDB_ASSET_PATH = '/duckdb/';

export async function createDuckDbWasmEngine(): Promise<DuckDbEngine> {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') {
        throw new Error('The SQL scratchpad needs a browser with Web Worker support');
    }
    const duckdb = await import('@duckdb/duckdb-wasm');
    const base = new URL(DUCKDB_ASSET_PATH, window.location.origin).href;
    const bundle = await duckdb.selectBundle({
        mvp: { mainModule: `${base}duckdb-mvp.wasm`, mainWorker: `${base}duckdb-browser-mvp.worker.js` },
        eh: { mainModule: `${base}duckdb-eh.wasm`, mainWorker: `${base}duckdb-browser-eh.worker.js` },
    });
    if (!bundle.mainWorker) throw new Error('No DuckDB worker bundle is available');
    const worker = new Worker(bundle.mainWorker);
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    try {
        await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
        await db.open({ query: { castBigIntToDouble: true, castDecimalToDouble: true } });
    } catch (error) {
        await db.terminate();
        throw error;
    }
    const conn = await db.connect();
    let fileSeq = 0;

    const query = async (sql: string, signal?: AbortSignal): Promise<DuckDbQueryResult> => {
        if (signal?.aborted) throw abortError();
        const onAbort = () => {
            void conn.cancelSent();
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        try {
            const table = await conn.query(sql);
            if (signal?.aborted) throw abortError();
            return arrowTableToRows(table as unknown as ArrowLikeTable);
        } finally {
            signal?.removeEventListener('abort', onAbort);
        }
    };

    return {
        exec: async sql => {
            await conn.query(sql);
        },
        query,
        insertJSON: async (table, jsonText) => {
            fileSeq += 1;
            const file = `rucio_ingest_${fileSeq}.json`;
            await db.registerFileText(file, jsonText);
            try {
                await conn.insertJSONFromPath(file, { name: table });
            } finally {
                await db.dropFile(file);
            }
        },
        terminate: async () => {
            try {
                await conn.close();
            } finally {
                await db.terminate();
            }
        },
    };
}
