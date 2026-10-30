import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs';
import { TelemetrySettingsForm, type TelemetrySettingsFormProps } from './TelemetrySettingsForm';
import type { AssistantSettings } from '@/lib/core/entity/assistant/settings';
import type { TelemetryTestResult } from '@/lib/infrastructure/assistant/telemetry-sinks';

function Stateful(props: TelemetrySettingsFormProps) {
    const [value, setValue] = useState<AssistantSettings['telemetry']>(props.value);
    return <TelemetrySettingsForm {...props} value={value} onChange={setValue} />;
}

const meta: Meta<typeof TelemetrySettingsForm> = {
    title: 'Features/Assistant/Settings/TelemetrySettingsForm',
    component: TelemetrySettingsForm,
    parameters: { layout: 'padded' },
    tags: ['autodocs'],
    render: args => <Stateful {...args} />,
    args: {
        origin: 'https://rucio-ui.example.org',
        config: { operatorSink: false, allowUserSinks: true, contentCap: 'full', hashUser: false },
        value: { enabled: false, contentLevel: 'metadata', shareWithOperator: false },
        onChange: () => undefined,
        onTestExport: async (): Promise<TelemetryTestResult> => ({ ok: true, status: 200 }),
    },
};

export default meta;
type Story = StoryObj<typeof TelemetrySettingsForm>;

export const Off: Story = {};

export const LangfuseConfigured: Story = {
    args: {
        value: {
            enabled: true,
            contentLevel: 'full',
            sink: { kind: 'langfuse', endpoint: 'https://cloud.langfuse.com', publicKey: 'pk-lf-demo', secretKey: 'sk-lf-demo' },
            shareWithOperator: false,
        },
    },
};

export const OtlpWithCorsError: Story = {
    args: {
        value: {
            enabled: true,
            contentLevel: 'metadata',
            sink: { kind: 'otlp', endpoint: 'https://otel.example.org/v1/traces', headers: { 'x-team': 'ddm' } },
            shareWithOperator: false,
        },
        onTestExport: async (): Promise<TelemetryTestResult> => ({ ok: false, reason: 'network' }),
    },
};

export const CappedAtMetadata: Story = {
    args: {
        config: { operatorSink: true, allowUserSinks: true, contentCap: 'metadata', hashUser: true },
        value: {
            enabled: true,
            contentLevel: 'full',
            sink: { kind: 'langfuse', endpoint: 'https://cloud.langfuse.com', publicKey: 'pk-lf-demo', secretKey: 'sk-lf-demo' },
            shareWithOperator: false,
        },
    },
};

export const OperatorSinkOnly: Story = {
    args: {
        config: { operatorSink: true, allowUserSinks: false, contentCap: 'metadata', hashUser: false },
    },
};

export const SharingWithDeployment: Story = {
    args: {
        config: { operatorSink: true, allowUserSinks: true, contentCap: 'full', hashUser: true },
        value: { enabled: false, contentLevel: 'full', shareWithOperator: true },
    },
};
