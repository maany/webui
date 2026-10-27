'use client';

import { useEffect, useRef } from 'react';
import { useAttachedPageActionRegistry } from '@/lib/infrastructure/assistant/page-action-bridge';
import { clampSummary, PAGE_SUMMARY_MAX } from '@/lib/infrastructure/assistant/page-summary-text';

export interface UsePageDescribeOptions {
    /** Defaults to true. */
    enabled?: boolean;
}

/**
 * Gives Rucio bot a short summary of the current page (at most 500 characters), read lazily when a
 * turn starts or read_current_page runs. Call it once per page, before any early return.
 */
export function usePageDescribe(describe: () => string, options: UsePageDescribeOptions = {}): void {
    const registry = useAttachedPageActionRegistry();
    const enabled = options.enabled ?? true;
    const latest = useRef(describe);

    useEffect(() => {
        latest.current = describe;
    });

    useEffect(() => {
        if (!registry || !enabled) return;
        registry.setDescriber(() => {
            try {
                return clampSummary(latest.current(), PAGE_SUMMARY_MAX);
            } catch {
                return '';
            }
        });
        return () => registry.setDescriber(null);
    }, [registry, enabled]);
}
