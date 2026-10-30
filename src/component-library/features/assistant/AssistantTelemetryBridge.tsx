'use client';

import { useSession } from 'next-auth/react';
import { useAssistantConfig } from '@/lib/infrastructure/hooks/useAssistantConfig';
import { useAssistantSettings } from '@/lib/infrastructure/hooks/useAssistantSettings';
import { toAccountKey } from '@/lib/infrastructure/assistant/page-context';
import { useAssistantTelemetry } from '@/lib/infrastructure/hooks/useAssistantTelemetry';
import { useAssistantEvents } from '@/component-library/features/assistant/AssistantProvider';

/** Renders nothing; feeds assistant events to OpenTelemetry when a sink is active. */
export function AssistantTelemetryBridge(): null {
    const { config, isLoading, error } = useAssistantConfig();
    const { settings } = useAssistantSettings();
    // The signed-in account, not the open conversation's: a stopped turn of the previous account can still
    // emit events after New chat or a switch, and each turn carries its own account on turn-started.
    const { data: session } = useSession();
    const accountKey = toAccountKey(session?.user?.rucioAccount, session?.user?.rucioVO);
    // useAssistantConfig falls back to the defaults on error, and those allow user sinks, which
    // could re-enable a sink the operator disabled. Fail closed until the real config is known.
    const listener = useAssistantTelemetry({
        config: isLoading || error ? undefined : config.telemetry,
        settings,
        accountKey,
    });
    useAssistantEvents(listener);
    return null;
}
