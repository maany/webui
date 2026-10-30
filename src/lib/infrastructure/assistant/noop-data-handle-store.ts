import type { AssistantDataHandleStorePort } from '@/lib/core/port/secondary/assistant-data-handle-store-port';

/** Placeholder until phase 2 adds the DuckDB store. Holds no data. */
export function createNoopDataHandleStore(): AssistantDataHandleStorePort {
    return {
        async ingestRows() {
            throw new Error('Data tables are not available in this version of Rucio bot.');
        },
        async query() {
            throw new Error('SQL is not available in this version of Rucio bot.');
        },
        listHandles: () => [],
        drop: async () => undefined,
        dropAll: async () => undefined,
        memoryBytes: async () => 0,
        terminate: async () => undefined,
    };
}
