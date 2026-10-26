import type { DataHandle, DataHandleProvenance, SqlResult } from '@/lib/core/entity/assistant/data-handle';

export interface AssistantDataHandleStorePort {
    ingestRows(
        baseName: string, // e.g. 'rules'; store appends _<n>
        provenance: DataHandleProvenance,
        rows: AsyncIterable<Record<string, unknown>>,
        options: { rowCap: number; signal?: AbortSignal },
    ): Promise<DataHandle>;
    query(sql: string, options: { maxRows: number; saveAs?: string; signal?: AbortSignal }): Promise<SqlResult>;
    listHandles(): DataHandle[];
    drop(name: string): Promise<void>;
    dropAll(): Promise<void>;
    memoryBytes(): Promise<number>;
    terminate(): Promise<void>;
}
