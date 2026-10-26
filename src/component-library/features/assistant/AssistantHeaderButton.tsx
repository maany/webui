'use client';

import React from 'react';
import { HiSparkles } from 'react-icons/hi';
import { cn } from '@/component-library/utils';
import { ASSISTANT_SHORTCUT_LABEL, useAssistantPanel } from '@/lib/infrastructure/hooks/useAssistantShell';

/** Header toggle next to the Tips button. Not rendered when Rucio bot is off. */
export function AssistantHeaderButton() {
    const { enabled, panelState, toggle } = useAssistantPanel();
    if (!enabled) return null;
    const active = panelState !== 'closed';
    return (
        <button
            type="button"
            onClick={toggle}
            aria-pressed={active}
            aria-label={`Rucio bot (${ASSISTANT_SHORTCUT_LABEL})`}
            title={`Rucio bot (${ASSISTANT_SHORTCUT_LABEL})`}
            className={cn('rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 px-2 items-center flex', active && 'text-brand-500')}
        >
            <HiSparkles className="h-6 w-6" />
        </button>
    );
}
