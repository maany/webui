'use client';

import React from 'react';
import { HiSparkles } from 'react-icons/hi';
import { cn } from '@/component-library/utils';
import { useAssistantPanel, useAssistantShortcutLabel } from '@/lib/infrastructure/hooks/useAssistantShell';

/** Header toggle next to the Tips button. Not rendered when Rucio bot is off. */
export function AssistantHeaderButton() {
    const { enabled, panelState, toggle } = useAssistantPanel();
    const shortcutLabel = useAssistantShortcutLabel();
    if (!enabled) return null;
    const active = panelState !== 'closed';
    return (
        <button
            type="button"
            onClick={toggle}
            aria-pressed={active}
            aria-label={`Rucio bot (${shortcutLabel})`}
            title={`Rucio bot (${shortcutLabel})`}
            className={cn('rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 px-2 items-center flex', active && 'text-brand-500')}
        >
            <HiSparkles className="h-6 w-6" />
        </button>
    );
}
