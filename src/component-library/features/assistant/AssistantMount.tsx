'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { useAssistantPanel } from '@/lib/infrastructure/hooks/useAssistantShell';

const AssistantRoot = dynamic(() => import('./AssistantRoot'), { ssr: false });

/**
 * Renders nothing while FEATURE_ASSISTANT is off or the panel was never
 * opened, so the assistant bundle (runner, provider SDKs, markdown) is not
 * downloaded. Once opened it stays mounted to keep the conversation.
 */
export function AssistantMount() {
    const { enabled, hasOpened } = useAssistantPanel();
    if (!enabled || !hasOpened) return null;
    return <AssistantRoot />;
}
