'use client';

import React from 'react';
import { AssistantPanel } from './AssistantPanel';
import { AssistantProvider } from './AssistantProvider';
import { AssistantTelemetryBridge } from './AssistantTelemetryBridge';

/** Everything that loads lazily the first time the panel opens. */
export default function AssistantRoot() {
    return (
        <AssistantProvider>
            <AssistantTelemetryBridge />
            <AssistantPanel />
        </AssistantProvider>
    );
}
