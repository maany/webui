'use client';

import React from 'react';
import { AssistantPanel } from './AssistantPanel';
import { AssistantProvider } from './AssistantProvider';

/** Everything that loads lazily the first time the panel opens. */
export default function AssistantRoot() {
    return (
        <AssistantProvider>
            <AssistantPanel />
        </AssistantProvider>
    );
}
