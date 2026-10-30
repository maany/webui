import path from 'path';
import * as duckdb from '@duckdb/duckdb-wasm/blocking';
import type { DuckDbEngine } from '@/lib/infrastructure/assistant/duckdb/duckdb-engine';
import { arrowTableToRows, type ArrowLikeTable } from '@/lib/infrastructure/assistant/duckdb/arrow-rows';

/** Real DuckDB (the same wasm build, through Node bindings) behind the DuckDbEngine interface. Node test environment only. */
export async function createNodeDuckDbEngine(): Promise<DuckDbEngine> {
    const dist = path.dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs'));
    const db = await duckdb.createDuckDB(
        {
            mvp: { mainModule: path.join(dist, 'duckdb-mvp.wasm'), mainWorker: path.join(dist, 'duckdb-node-mvp.worker.cjs') },
            eh: { mainModule: path.join(dist, 'duckdb-eh.wasm'), mainWorker: path.join(dist, 'duckdb-node-eh.worker.cjs') },
        },
        new duckdb.VoidLogger(),
        duckdb.NODE_RUNTIME,
    );
    await db.instantiate(() => undefined);
    db.open({ query: { castBigIntToDouble: true, castDecimalToDouble: true } });
    const conn = db.connect();
    let fileSeq = 0;
    return {
        exec: async sql => {
            conn.query(sql);
        },
        query: async sql => arrowTableToRows(conn.query(sql) as unknown as ArrowLikeTable),
        insertJSON: async (table, jsonText) => {
            fileSeq += 1;
            const file = `rucio_ingest_${fileSeq}.json`;
            db.registerFileText(file, jsonText);
            try {
                conn.insertJSONFromPath(file, { name: table });
            } finally {
                db.dropFile(file);
            }
        },
        terminate: async () => {
            conn.close();
        },
    };
}
