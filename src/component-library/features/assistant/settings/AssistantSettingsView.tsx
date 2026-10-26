'use client';

import * as React from 'react';
import { Heading } from '@/component-library/atoms/misc/Heading';
import { Alert } from '@/component-library/atoms/feedback/Alert';
import { LoadingSpinner } from '@/component-library/atoms/loading';
import { TabSwitcher } from '@/component-library/features/tabs/TabSwitcher';
import type { AssistantConfig } from '@/lib/core/entity/assistant/assistant-config';
import type { AssistantSettings } from '@/lib/core/entity/assistant/settings';
import type { ResolvedProvider } from '@/lib/core/entity/assistant/provider-config';
import type { ConnectionTestResult } from '@/lib/infrastructure/assistant/connection-test';
import { ProvidersTab } from './ProvidersTab';
import { SkillsTabContainer } from './SkillsTabContainer';
import { TelemetryTab } from './TelemetryTab';
import { DisplayTab } from './DisplayTab';
import { StorageTab } from './StorageTab';
import { AssistantStorageSection } from './AssistantStorageSection';

export interface AssistantSettingsViewProps {
    config: AssistantConfig;
    configLoading: boolean;
    configError?: Error;
    settings: AssistantSettings;
    onUpdate(patch: (settings: AssistantSettings) => AssistantSettings): void;
    onReset(): void;
    onTestConnection(resolved: ResolvedProvider, signal?: AbortSignal): Promise<ConnectionTestResult>;
    newId(): string;
}

/** Later phases append tabs here (Permissions, Skills, Telemetry, conversation storage). */
export const ASSISTANT_SETTINGS_TABS: { name: string; render(props: AssistantSettingsViewProps): React.ReactNode }[] = [
    {
        name: 'Providers',
        render: p => (
            <ProvidersTab config={p.config} settings={p.settings} onUpdate={p.onUpdate} onTestConnection={p.onTestConnection} newId={p.newId} />
        ),
    },
    { name: 'Skills', render: p => <SkillsTabContainer config={p.config} settings={p.settings} onUpdate={p.onUpdate} /> },
    { name: 'Telemetry', render: p => <TelemetryTab config={p.config} settings={p.settings} onUpdate={p.onUpdate} /> },
    { name: 'Display', render: p => <DisplayTab settings={p.settings} onUpdate={p.onUpdate} /> },
    {
        name: 'Storage',
        render: p => (
            <div className="space-y-10">
                <AssistantStorageSection settings={p.settings} onUpdate={p.onUpdate} />
                <StorageTab onReset={p.onReset} />
            </div>
        ),
    },
];

export const AssistantSettingsView: React.FC<AssistantSettingsViewProps> = props => {
    const [tab, setTab] = React.useState(0);
    return (
        <div className="flex w-full flex-col gap-6">
            <header className="space-y-2">
                <Heading level="h1" className="text-3xl sm:text-4xl">
                    Rucio bot settings
                </Heading>
                <p className="text-base text-neutral-600 dark:text-neutral-400">
                    Choose the model Rucio bot uses and how it shows its work. These settings are saved in this browser.
                </p>
            </header>
            {props.configError && <Alert variant="warning" message="Could not load the operator settings. Showing defaults." />}
            <TabSwitcher tabNames={ASSISTANT_SETTINGS_TABS.map(t => t.name)} activeIndex={tab} onSwitch={setTab} />
            <div role="tabpanel" aria-label={ASSISTANT_SETTINGS_TABS[tab].name}>
                {props.configLoading ? (
                    <div className="flex items-center justify-center gap-3 py-12 text-sm text-neutral-600 dark:text-neutral-400">
                        <LoadingSpinner aria-hidden="true" />
                        <span>Loading operator settings</span>
                    </div>
                ) : (
                    ASSISTANT_SETTINGS_TABS[tab].render(props)
                )}
            </div>
        </div>
    );
};
