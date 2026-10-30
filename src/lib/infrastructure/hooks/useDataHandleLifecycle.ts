'use client';

import { useEffect } from 'react';
import type { AssistantDataHandleStorePort } from '@/lib/core/port/secondary/assistant-data-handle-store-port';

/**
 * Terminates DuckDB when the assistant provider unmounts. Dropping handles on new chat, history switch and
 * account switch is done by the phase 1b chat controller (resetView calls handles.dropAll()).
 */
export function useDataHandleLifecycle(store: AssistantDataHandleStorePort): void {
    useEffect(
        () => () => {
            void store.terminate();
        },
        [store],
    );
}
