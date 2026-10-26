'use client';

import React, { useState } from 'react';
import { HiChevronDown, HiChevronRight } from 'react-icons/hi';
import type { ChatMessage } from '@/lib/core/entity/assistant/conversation';
import { activityLabel, formatDuration, summarizeActivity } from './format';

export interface ActivityLineProps {
    message: ChatMessage;
    defaultExpanded: boolean;
}

/**
 * One collapsed line per assistant turn: reasoning time, tool count, tokens
 * and cost. Expanded it shows the reasoning text and a plain list of tool
 * calls (phase 2 replaces the list with the full timeline).
 */
export function ActivityLine({ message, defaultExpanded }: ActivityLineProps) {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const summary = summarizeActivity(message);
    const label = activityLabel(summary);
    if (!label) return null;
    const reasoning = message.parts.filter(part => part.type === 'reasoning');
    const toolCalls = message.parts.filter(part => part.type === 'tool-call');
    return (
        <div className="text-xs text-neutral-600 dark:text-neutral-400">
            <button
                type="button"
                className="flex items-center gap-1 hover:text-neutral-900 dark:hover:text-neutral-100"
                aria-expanded={expanded}
                onClick={() => setExpanded(value => !value)}
            >
                {expanded ? <HiChevronDown className="h-4 w-4" aria-hidden="true" /> : <HiChevronRight className="h-4 w-4" aria-hidden="true" />}
                <span>{label}</span>
            </button>
            {expanded && (
                <div className="mt-1 ml-5 space-y-2 border-l border-neutral-200 dark:border-neutral-700 pl-3">
                    {reasoning.map((part, index) => (
                        <p key={`reasoning-${index}`} className="whitespace-pre-wrap italic">
                            {part.type === 'reasoning' ? part.text : null}
                        </p>
                    ))}
                    {toolCalls.length > 0 && (
                        <ul className="space-y-0.5">
                            {toolCalls.map(part =>
                                part.type === 'tool-call' ? (
                                    <li key={part.toolCallId} className="font-mono">
                                        {part.toolName} · {part.status}
                                        {part.durationMs !== undefined ? ` · ${formatDuration(part.durationMs)}` : ''}
                                        {part.error ? ` · ${part.error.error}` : ''}
                                    </li>
                                ) : null,
                            )}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}
