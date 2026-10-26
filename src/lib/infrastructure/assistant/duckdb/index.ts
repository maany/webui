import { DuckDbDataHandleStore } from './duckdb-data-handle-store';
import { createDuckDbWasmEngine } from './duckdb-wasm-engine';

let store: DuckDbDataHandleStore | undefined;

/** The browser-wide data handle store. DuckDB-wasm loads on the first rows result, not before. */
export function getAssistantDataHandleStore(): DuckDbDataHandleStore {
    if (!store) {
        // When the engine had to kill a query that would not stop, its tables are gone: expire every handle.
        store = new DuckDbDataHandleStore(() => createDuckDbWasmEngine({ onTerminated: dead => void store?.terminateEngine(dead) }));
    }
    return store;
}
