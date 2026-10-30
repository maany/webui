import { useSyncExternalStore } from 'react';
import type { AssistantPageActionRegistryPort } from '@/lib/core/port/secondary/assistant-page-action-registry-port';

/**
 * Module-level seam between the assistant shell and page hooks (phase 3), so
 * pages never import the assistant bundle. Holds at most one registry.
 */
let attached: AssistantPageActionRegistryPort | null = null;
const listeners = new Set<() => void>();

function notify(): void {
    for (const listener of Array.from(listeners)) listener();
}

/** Attaches a registry (or detaches with null). Returns a function that detaches it again. */
export function attachPageActionRegistry(registry: AssistantPageActionRegistryPort | null): () => void {
    attached = registry;
    notify();
    return () => {
        if (attached === registry && registry !== null) {
            attached = null;
            notify();
        }
    };
}

export function getAttachedPageActionRegistry(): AssistantPageActionRegistryPort | null {
    return attached;
}

export function subscribeToPageActionRegistry(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** The attached registry, or null when Rucio bot is off. Re-renders when it changes. */
export function useAttachedPageActionRegistry(): AssistantPageActionRegistryPort | null {
    return useSyncExternalStore(subscribeToPageActionRegistry, getAttachedPageActionRegistry, () => null);
}
