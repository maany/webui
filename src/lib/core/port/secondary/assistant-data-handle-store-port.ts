import type { DataHandle, DataHandleProvenance, SqlResult } from '@/lib/core/entity/assistant/data-handle';

export interface IngestRowsOptions {
    rowCap: number;
    signal?: AbortSignal;
    /** Exact table name to (re)create, replacing an existing table of that name. Used by refresh. */
    name?: string;
    /** Read after the rows are consumed; a string marks the handle truncated and sets DataHandle.error. */
    sourceError?: () => string | undefined;
}

export interface AssistantDataHandleStorePort {
    ingestRows(
        baseName: string, // e.g. 'rules'; store appends _<n>
        provenance: DataHandleProvenance,
        rows: AsyncIterable<Record<string, unknown>>,
        options: IngestRowsOptions,
    ): Promise<DataHandle>;
    query(sql: string, options: { maxRows: number; saveAs?: string; signal?: AbortSignal }): Promise<SqlResult>;
    listHandles(): DataHandle[];
    drop(name: string): Promise<void>;
    dropAll(): Promise<void>;
    memoryBytes(): Promise<number>;
    terminate(): Promise<void>;
    /** Notifies after any change to listHandles(). */
    subscribe?(listener: () => void): () => void;
}
