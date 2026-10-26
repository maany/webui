'use client';

import * as React from 'react';
import '@/lib/infrastructure/assistant/tools';
import { Alert } from '@/component-library/atoms/feedback/Alert';
import type { AssistantConfig } from '@/lib/core/entity/assistant/assistant-config';
import type { AssistantSettings } from '@/lib/core/entity/assistant/settings';
import { allTools } from '@/lib/infrastructure/assistant/tool-registry';
import { useToolVisibilityContext } from '@/lib/infrastructure/hooks/useToolVisibilityContext';
import { PermissionsTab } from './PermissionsTab';

export interface PermissionsTabContainerProps {
    config: AssistantConfig;
    configError?: Error;
    settings: AssistantSettings;
    onUpdate(patch: (settings: AssistantSettings) => AssistantSettings): void;
}

/** The Permissions entry of ASSISTANT_SETTINGS_TABS. The settings view already waits for the operator config. */
export function PermissionsTabContainer({ config, configError, settings, onUpdate }: PermissionsTabContainerProps) {
    const visibility = useToolVisibilityContext();
    const tools = React.useMemo(() => allTools().map(tool => tool.spec), []);

    if (configError) {
        return <Alert variant="error" message="Could not load the operator limits. Write tools stay blocked until they load." />;
    }

    return (
        <PermissionsTab
            tools={tools}
            visibility={visibility}
            config={config}
            prefs={settings.toolPolicies}
            onChange={toolPolicies => onUpdate(current => ({ ...current, toolPolicies }))}
        />
    );
}
