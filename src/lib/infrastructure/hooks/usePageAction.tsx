'use client';

import { useEffect, useRef } from 'react';
import type { PageActionRegistration } from '@/lib/core/port/secondary/assistant-page-action-registry-port';
import { useAttachedPageActionRegistry } from '@/lib/infrastructure/assistant/page-action-bridge';

export interface UsePageActionOptions {
    /** Defaults to true. A disabled action is not offered to Rucio bot. */
    enabled?: boolean;
}

/**
 * Offers a typed action of the current page to Rucio bot. The action is registered on mount and
 * removed on unmount. The latest `apply` is always used, so callers can pass inline closures without
 * re-registering on every render. The schema, name and description are read when the action registers
 * (a new name or description registers it again). Does nothing while Rucio bot is off (no registry attached).
 */
export function usePageAction<I>(action: PageActionRegistration<I>, options: UsePageActionOptions = {}): void {
    const registry = useAttachedPageActionRegistry();
    const enabled = options.enabled ?? true;
    const latest = useRef(action);

    useEffect(() => {
        latest.current = action;
    });

    const { name, description } = action;

    useEffect(() => {
        if (!registry || !enabled) return;
        return registry.register({
            name,
            description,
            schema: latest.current.schema,
            apply: (args: I) => latest.current.apply(args),
        });
    }, [registry, enabled, name, description]);
}
