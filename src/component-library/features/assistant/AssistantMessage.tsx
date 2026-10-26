'use client';

import React from 'react';
import type { ChatMessage, MessagePart } from '@/lib/core/entity/assistant/conversation';
import { cn } from '@/component-library/utils';
import { ActivityLine } from './ActivityLine';
import { Markdown } from './Markdown';
import { ToolApprovalSlot, type ApprovalPart } from './ToolApprovalSlot';

function Notice({ part }: { part: Extract<MessagePart, { type: 'notice' }> }) {
    return (
        <p
            role={part.level === 'error' ? 'alert' : undefined}
            className={cn(
                'text-xs rounded px-2 py-1',
                part.level === 'error' && 'bg-base-error-100 text-base-error-700 dark:bg-base-error-900/40 dark:text-base-error-300',
                part.level === 'warning' && 'bg-base-warning-100 text-base-warning-800 dark:bg-base-warning-900/40 dark:text-base-warning-300',
                part.level === 'info' && 'text-neutral-500 dark:text-neutral-400',
            )}
        >
            {part.text}
        </p>
    );
}

export interface AssistantMessageProps {
    message: ChatMessage;
    detail: 'compact' | 'verbose';
}

export function AssistantMessage({ message, detail }: AssistantMessageProps) {
    if (message.role === 'user') {
        const text = message.parts.map(part => (part.type === 'text' ? part.text : '')).join('');
        const context = message.parts.find(part => part.type === 'page-context');
        return (
            <div className="flex flex-col items-end gap-1">
                <div className="max-w-[85%] rounded-lg bg-brand-600 text-neutral-0 px-3 py-2 text-sm whitespace-pre-wrap break-words">{text}</div>
                {context && context.type === 'page-context' && <span className="text-[11px] text-neutral-500">Page: {context.context.route}</span>}
            </div>
        );
    }
    const approvals = new Map<string, ApprovalPart>();
    for (const part of message.parts) if (part.type === 'approval') approvals.set(part.toolCallId, part);
    return (
        <div className="flex flex-col gap-2">
            <ActivityLine message={message} defaultExpanded={detail === 'verbose'} />
            {message.parts.map(part =>
                part.type === 'tool-call' ? (
                    <ToolApprovalSlot key={`approval-${part.toolCallId}`} part={part} approval={approvals.get(part.toolCallId)} />
                ) : null,
            )}
            {message.parts.map((part, index) => {
                if (part.type === 'text') return <Markdown key={`text-${index}`} text={part.text} />;
                if (part.type === 'notice') return <Notice key={`notice-${index}`} part={part} />;
                return null;
            })}
        </div>
    );
}
