'use client';

import { useAssistantConfig } from '@/lib/infrastructure/hooks/useAssistantConfig';
import { useAssistantSettings } from '@/lib/infrastructure/hooks/useAssistantSettings';
import { useAssistant } from '@/lib/infrastructure/hooks/useAssistant';
import { useAssistantTelemetry } from '@/lib/infrastructure/hooks/useAssistantTelemetry';
import { useAssistantEvents } from '@/component-library/features/assistant/AssistantProvider';

/** Renders nothing; feeds assistant events to OpenTelemetry when a sink is active. */
export function AssistantTelemetryBridge(): null {
    const { config, isLoading, error } = useAssistantConfig();
    const { settings } = useAssistantSettings();
    const { conversation } = useAssistant();
    // useAssistantConfig falls back to the defaults on error, and those allow user sinks, which
    // could re-enable a sink the operator disabled. Fail closed until the real config is known.
    const listener = useAssistantTelemetry({
        config: isLoading || error ? undefined : config.telemetry,
        settings,
        accountKey: conversation?.accountKey,
    });
    useAssistantEvents(listener);
    return null;
}
