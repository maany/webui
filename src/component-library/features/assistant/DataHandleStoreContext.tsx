'use client';

import React, { createContext, useCallback, useContext, useMemo, useRef, useSyncExternalStore } from 'react';
import type { DataHandle } from '@/lib/core/entity/assistant/data-handle';
import type { ToolPolicy } from '@/lib/core/entity/assistant/tool';
import type { AssistantDataHandleStorePort } from '@/lib/core/port/secondary/assistant-data-handle-store-port';

/** The live checks refresh_handle applies before re-running a tool; the Refresh button applies the same ones. */
export interface RefreshGate {
    isToolVisible?: (name: string) => boolean;
    toolPolicy?: (name: string) => ToolPolicy;
}

interface DataHandleStoreContextValue {
    store: AssistantDataHandleStorePort;
    gate: RefreshGate;
}

const DataHandleStoreContext = createContext<DataHandleStoreContextValue | null>(null);
const EMPTY: DataHandle[] = [];
const NO_GATE: RefreshGate = {};
const noSubscription = () => () => undefined;

export const DataHandleStoreProvider = ({
    store,
    isToolVisible,
    toolPolicy,
    children,
}: RefreshGate & { store: AssistantDataHandleStorePort; children: React.ReactNode }) => {
    // Read the latest callbacks without changing the context value on every render.
    const gateRef = useRef<RefreshGate>({});
    gateRef.current = { isToolVisible, toolPolicy };
    const value = useMemo<DataHandleStoreContextValue>(
        () => ({
            store,
            gate: {
                isToolVisible: name => gateRef.current.isToolVisible?.(name) ?? true,
                toolPolicy: name => gateRef.current.toolPolicy?.(name) ?? 'allow',
            },
        }),
        [store],
    );
    return <DataHandleStoreContext.Provider value={value}>{children}</DataHandleStoreContext.Provider>;
};

/** The data handle store, or null outside a DataHandleStoreProvider (for example in Storybook). */
export function useOptionalDataHandleStore(): AssistantDataHandleStorePort | null {
    return useContext(DataHandleStoreContext)?.store ?? null;
}

/** Visibility and policy checks for the Refresh button; permissive outside a provider. */
export function useRefreshGate(): RefreshGate {
    return useContext(DataHandleStoreContext)?.gate ?? NO_GATE;
}

/** Live handles, re-rendering on every store change. Empty without a provider. */
export function useLiveHandles(): DataHandle[] {
    const store = useOptionalDataHandleStore();
    const cache = useRef<DataHandle[]>(EMPTY);
    const subscribe = useMemo(() => (store?.subscribe ? (listener: () => void) => store.subscribe!(listener) : noSubscription), [store]);
    const getSnapshot = useCallback(() => {
        const next = store ? store.listHandles() : EMPTY;
        const previous = cache.current;
        if (next === previous || (next.length === previous.length && next.every((handle, index) => handle === previous[index]))) return previous;
        cache.current = next;
        return next;
    }, [store]);
    return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}
