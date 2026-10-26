'use client';

import type { AssistantConfig } from '@/lib/core/entity/assistant/assistant-config';
import type { AssistantSettings, TelemetrySinkSettings } from '@/lib/core/entity/assistant/settings';
import { userSinkTarget, type TelemetryTestResult } from '@/lib/infrastructure/assistant/telemetry-sinks';
import { TelemetrySettingsForm } from '@/component-library/features/assistant/settings/TelemetrySettingsForm';

export interface TelemetryTabProps {
    config: AssistantConfig;
    settings: AssistantSettings;
    onUpdate(patch: (settings: AssistantSettings) => AssistantSettings): void;
}

async function runTestExport(sink: TelemetrySinkSettings): Promise<TelemetryTestResult> {
    const { testTelemetryExport } = await import('@/lib/infrastructure/assistant/telemetry-test-export');
    return testTelemetryExport(userSinkTarget(sink));
}

/** Telemetry entry of ASSISTANT_SETTINGS_TABS (phase 1a); the settings view only renders it once the config has loaded. */
export function TelemetryTab({ config, settings, onUpdate }: TelemetryTabProps) {
    return (
        <TelemetrySettingsForm
            config={config.telemetry}
            value={settings.telemetry}
            onChange={telemetry => onUpdate(current => ({ ...current, telemetry }))}
            onTestExport={runTestExport}
            origin={typeof window === 'undefined' ? '' : window.location.origin}
        />
    );
}
