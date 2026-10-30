'use client';

import * as React from 'react';
import type { AssistantSettings } from '@/lib/core/entity/assistant/settings';
import { ChoiceGroup, type ChoiceOption } from './ChoiceGroup';

const DETAIL_OPTIONS: ChoiceOption<AssistantSettings['display']['detail']>[] = [
    { value: 'compact', label: 'Compact', description: 'One summary line per answer. Expand it to see tool calls and queries.' },
    { value: 'verbose', label: 'Verbose', description: 'Show every tool call, query and reasoning step expanded.' },
];

export interface DisplayTabProps {
    settings: AssistantSettings;
    onUpdate(patch: (settings: AssistantSettings) => AssistantSettings): void;
}

export const DisplayTab: React.FC<DisplayTabProps> = ({ settings, onUpdate }) => (
    <section aria-labelledby="assistant-display-heading" className="space-y-4">
        <h2 id="assistant-display-heading" className="sr-only">
            Display
        </h2>
        <ChoiceGroup
            name="assistant-display-detail"
            legend="Activity details"
            value={settings.display.detail}
            options={DETAIL_OPTIONS}
            onChange={detail => onUpdate(s => ({ ...s, display: { ...s.display, detail } }))}
        />
    </section>
);
