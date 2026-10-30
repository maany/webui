'use client';

import * as React from 'react';
import type { ResolvedProvider } from '@/lib/core/entity/assistant/provider-config';
import { useAssistantConfig } from '@/lib/infrastructure/hooks/useAssistantConfig';
import { useAssistantSettings } from '@/lib/infrastructure/hooks/useAssistantSettings';
import { testProviderConnection } from '@/lib/infrastructure/assistant/connection-test';
import { AssistantSettingsView } from './AssistantSettingsView';

/** crypto.randomUUID only exists in secure contexts; plain-HTTP deployments get a random fallback id. */
function newProviderId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Client container of /assistant/settings: wires the hooks and the connection test to the view. */
export const AssistantSettings: React.FC = () => {
    const { config, isLoading, error } = useAssistantConfig();
    const { settings, update, reset } = useAssistantSettings();
    const controllers = React.useRef(new Set<AbortController>());

    React.useEffect(() => {
        const active = controllers.current;
        return () => active.forEach(controller => controller.abort());
    }, []);

    const testConnection = React.useCallback(async (resolved: ResolvedProvider, signal?: AbortSignal) => {
        const controller = new AbortController();
        controllers.current.add(controller);
        const onAbort = () => controller.abort();
        if (signal?.aborted) controller.abort();
        signal?.addEventListener('abort', onAbort);
        try {
            return await testProviderConnection(resolved, controller.signal);
        } finally {
            signal?.removeEventListener('abort', onAbort);
            controllers.current.delete(controller);
        }
    }, []);

    return (
        <AssistantSettingsView
            config={config}
            configLoading={isLoading}
            configError={error}
            settings={settings}
            onUpdate={update}
            onReset={reset}
            onTestConnection={testConnection}
            newId={newProviderId}
        />
    );
};
