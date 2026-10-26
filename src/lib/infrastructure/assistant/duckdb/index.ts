import { DuckDbDataHandleStore } from './duckdb-data-handle-store';
import { createDuckDbWasmEngine } from './duckdb-wasm-engine';

let store: DuckDbDataHandleStore | undefined;

/** The browser-wide data handle store. DuckDB-wasm loads on the first rows result, not before. */
export function getAssistantDataHandleStore(): DuckDbDataHandleStore {
    if (!store) store = new DuckDbDataHandleStore(createDuckDbWasmEngine);
    return store;
}
