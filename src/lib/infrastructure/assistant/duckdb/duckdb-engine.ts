/** The small slice of DuckDB the data handle store needs. The browser uses duckdb-wasm; tests use a fake or Node bindings. */
export interface DuckDbQueryResult {
    columns: string[];
    rows: Record<string, unknown>[];
}

export interface DuckDbEngine {
    exec(sql: string): Promise<void>;
    query(sql: string, signal?: AbortSignal): Promise<DuckDbQueryResult>;
    /** Creates table `table` from a JSON array of row objects. */
    insertJSON(table: string, jsonText: string): Promise<void>;
    terminate(): Promise<void>;
}

export type DuckDbEngineFactory = () => Promise<DuckDbEngine>;

/** Run once per engine before any other statement. lock_configuration must stay last. */
export const ENGINE_INIT_SQL: readonly string[] = [
    'SET enable_external_access = false',
    'SET autoinstall_known_extensions = false',
    'SET autoload_known_extensions = false',
    'SET lock_configuration = true',
];
