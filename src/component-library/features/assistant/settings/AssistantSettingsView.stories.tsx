import type { Meta, StoryObj } from '@storybook/nextjs';
import { useRef, useState } from 'react';
import { AssistantSettingsView } from './AssistantSettingsView';
import { DEFAULT_ASSISTANT_CONFIG, type AssistantConfig } from '@/lib/core/entity/assistant/assistant-config';
import type { AssistantSettings } from '@/lib/core/entity/assistant/settings';
import { getDefaultAssistantSettings } from '@/lib/infrastructure/assistant/settings-storage';
import type { ConnectionTestResult } from '@/lib/infrastructure/assistant/connection-test';

const operatorConfig: AssistantConfig = {
    ...DEFAULT_ASSISTANT_CONFIG,
    defaultProvider: { kind: 'openai-compatible', model: 'gpt-oss-120b', label: 'CERN GPT-OSS', contextWindow: 131072 },
};

const withProviders: AssistantSettings = {
    ...getDefaultAssistantSettings(),
    activeProviderId: 'p-claude',
    providers: [
        { id: 'p-claude', kind: 'anthropic', label: 'My Claude', apiKey: 'sk-ant-example', model: 'claude-sonnet-5-5' },
        { id: 'p-ollama', kind: 'ollama', label: 'Laptop Ollama', model: 'qwen3' },
    ],
};

interface StatefulProps {
    config: AssistantConfig;
    initial: AssistantSettings;
    configLoading?: boolean;
    configError?: Error;
    testResult: ConnectionTestResult;
}

const Stateful = ({ config, initial, configLoading = false, configError, testResult }: StatefulProps) => {
    const [settings, setSettings] = useState<AssistantSettings>(initial);
    const counter = useRef(0);
    return (
        <div className="mx-auto max-w-5xl p-4">
            <AssistantSettingsView
                config={config}
                configLoading={configLoading}
                configError={configError}
                settings={settings}
                onUpdate={patch => setSettings(current => patch(current))}
                onReset={() => setSettings(getDefaultAssistantSettings())}
                onTestConnection={async () => {
                    await new Promise(resolve => setTimeout(resolve, 600));
                    return testResult;
                }}
                newId={() => `story-${++counter.current}`}
            />
        </div>
    );
};

const meta: Meta<typeof Stateful> = {
    title: 'Features/Assistant/Settings',
    component: Stateful,
    parameters: { layout: 'fullscreen' },
    tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Stateful>;

export const OperatorDefault: Story = {
    args: { config: operatorConfig, initial: getDefaultAssistantSettings(), testResult: { ok: true, latencyMs: 412 } },
};

export const WithPersonalProviders: Story = {
    args: {
        config: operatorConfig,
        initial: withProviders,
        testResult: {
            ok: false,
            code: 'cors',
            hint: 'Ollama did not accept requests from this page. Start it with: OLLAMA_ORIGINS=http://localhost:6006 ollama serve',
        },
    },
};

export const PersonalProvidersOff: Story = {
    args: { config: { ...operatorConfig, allowByok: false }, initial: withProviders, testResult: { ok: true, latencyMs: 380 } },
};

export const OnlySomeKindsAllowed: Story = {
    args: { config: { ...operatorConfig, allowedProviderKinds: ['ollama'] }, initial: withProviders, testResult: { ok: true, latencyMs: 90 } },
};

export const NothingConfigured: Story = {
    args: {
        config: { ...DEFAULT_ASSISTANT_CONFIG, allowByok: false },
        initial: getDefaultAssistantSettings(),
        testResult: { ok: true, latencyMs: 1 },
    },
};

export const Loading: Story = {
    args: { config: DEFAULT_ASSISTANT_CONFIG, initial: getDefaultAssistantSettings(), configLoading: true, testResult: { ok: true, latencyMs: 1 } },
};

export const ConfigError: Story = {
    args: { config: DEFAULT_ASSISTANT_CONFIG, initial: withProviders, configError: new Error('HTTP 500'), testResult: { ok: true, latencyMs: 1 } },
};
