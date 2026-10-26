'use client';

import React from 'react';
import { cn } from '@/component-library/utils';
import { formatTokens } from './format';

export interface ContextGaugeProps {
    fraction: number | null;
    contextWindow?: number;
}

/** "41% of 200k" with a small bar. Hidden when the context window is unknown. */
export function ContextGauge({ fraction, contextWindow }: ContextGaugeProps) {
    if (fraction === null || !contextWindow) return null;
    const percent = Math.min(100, Math.max(0, Math.round(fraction * 100)));
    const label = `${percent}% of ${formatTokens(contextWindow)}`;
    return (
        <div className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400" title={`Context used: ${label}`}>
            <div
                className="h-1.5 w-12 rounded-full bg-neutral-200 dark:bg-neutral-700 overflow-hidden"
                role="meter"
                aria-label="Context used"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
            >
                <div className={cn('h-full rounded-full', percent > 70 ? 'bg-base-warning-500' : 'bg-brand-500')} style={{ width: `${percent}%` }} />
            </div>
            <span>{label}</span>
        </div>
    );
}
