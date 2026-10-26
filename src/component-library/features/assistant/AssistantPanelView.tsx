'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { HiOutlineCog, HiPlus, HiSparkles, HiX } from 'react-icons/hi';
import type { ChatMessage, Conversation } from '@/lib/core/entity/assistant/conversation';
import type { PageContext } from '@/lib/core/entity/assistant/page-context';
import { STEP_LIMIT_NOTICE } from '@/lib/infrastructure/assistant/message-reducer';
import { clampPanelWidth, PANEL_MAX_WIDTH, PANEL_MIN_WIDTH } from '@/lib/infrastructure/assistant/panel-storage';
import { cn } from '@/component-library/utils';
import { AssistantMessage } from './AssistantMessage';
import { Composer } from './Composer';
import { ContextGauge } from './ContextGauge';
import { HistoryMenu } from './HistoryMenu';

export interface AssistantPanelViewProps {
    state: 'open' | 'minimized';
    isMobile: boolean;
    width: number;
    onResize(width: number): void;
    status: 'idle' | 'streaming' | 'awaiting-approval' | 'error';
    conversation?: Conversation;
    conversations: Conversation[];
    messages: ChatMessage[];
    contextFraction: number | null;
    contextWindow?: number;
    error?: string;
    /** True when the error is an expired Rucio session; adds a login link. */
    sessionExpired?: boolean;
    persistent: boolean;
    pageContext?: PageContext;
    detail: 'compact' | 'verbose';
    /** Bottom inset from the on-screen keyboard (mobile). */
    keyboardInset?: number;
    onSend(text: string, attachPageContext: boolean): void;
    onStop(): void;
    onRetry(): void;
    onContinue(): void;
    onNewChat(): void;
    onOpenConversation(id: string): void;
    onDeleteConversation(id: string): void | Promise<void>;
    onClose(): void;
    onRestore(): void;
    /** Rendered when there are no messages (phase 3 adds starter prompts). */
    emptyState?: React.ReactNode;
}

const RESIZE_STEP = 16;

function endsWithStepLimit(messages: ChatMessage[]): boolean {
    const last = messages[messages.length - 1];
    return !!last && last.role === 'assistant' && last.parts.some(part => part.type === 'notice' && part.text === STEP_LIMIT_NOTICE);
}

export function AssistantPanelView(props: AssistantPanelViewProps) {
    const { state, isMobile, width, onResize, messages, status } = props;
    const listEnd = useRef<HTMLDivElement>(null);
    const busy = status === 'streaming' || status === 'awaiting-approval';

    const nearBottom = useRef(true);
    const stopResize = useRef<(() => void) | null>(null);
    const previousStatus = useRef(status);
    const [announcement, setAnnouncement] = useState('');

    useEffect(() => {
        const node = listEnd.current;
        if (nearBottom.current && node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'end' });
    }, [messages]);

    // Announce turn milestones only, never streamed tokens.
    useEffect(() => {
        const before = previousStatus.current;
        previousStatus.current = status;
        if (before === status) return;
        if (status === 'streaming') setAnnouncement('Rucio bot is responding');
        else if (status === 'awaiting-approval') setAnnouncement('Rucio bot needs your approval');
        else if (status === 'error') setAnnouncement('Rucio bot hit an error');
        else if (before === 'streaming' || before === 'awaiting-approval') setAnnouncement('Rucio bot finished responding');
    }, [status]);

    // Drop drag listeners when the panel unmounts or is minimized mid-drag.
    useEffect(() => () => stopResize.current?.(), [state]);

    if (state === 'minimized') {
        return (
            <button
                type="button"
                onClick={props.onRestore}
                className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full bg-brand-600 px-4 py-3 text-neutral-0 shadow-lg"
                style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
            >
                <HiSparkles className="h-5 w-5" aria-hidden="true" />
                Rucio bot
            </button>
        );
    }

    const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        const onMove = (move: PointerEvent) => onResize(clampPanelWidth(window.innerWidth - move.clientX, window.innerWidth));
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
            stopResize.current = null;
        };
        stopResize.current?.();
        stopResize.current = onUp;
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
    };

    return (
        // Escape closes the panel from anywhere inside it; the aside is a landmark, not a widget.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <aside
            aria-label="Rucio bot"
            className={cn(
                'fixed z-50 flex flex-col bg-neutral-0 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100',
                isMobile ? 'inset-0' : 'top-0 bottom-0 right-0 border-l border-neutral-200 dark:border-neutral-800 shadow-xl',
            )}
            style={isMobile ? { paddingTop: 'env(safe-area-inset-top)' } : { width }}
            onKeyDown={event => {
                // A popover inside the panel (history menu) handles its own Escape first.
                if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing) props.onClose();
            }}
        >
            {!isMobile && (
                // A focusable separator is the ARIA window splitter pattern.
                // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
                <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize Rucio bot panel"
                    aria-valuemin={PANEL_MIN_WIDTH}
                    aria-valuemax={PANEL_MAX_WIDTH}
                    aria-valuenow={width}
                    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
                    tabIndex={0}
                    className="absolute left-0 top-0 bottom-0 w-1.5 -translate-x-1/2 cursor-col-resize hover:bg-brand-500/40 focus:bg-brand-500/40 focus:outline-hidden"
                    onPointerDown={startResize}
                    onKeyDown={event => {
                        if (event.key === 'ArrowLeft') onResize(clampPanelWidth(width + RESIZE_STEP, window.innerWidth));
                        if (event.key === 'ArrowRight') onResize(clampPanelWidth(width - RESIZE_STEP, window.innerWidth));
                    }}
                />
            )}
            <header className="flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-800 px-3 py-2">
                <HiSparkles className="h-5 w-5 text-brand-600 dark:text-brand-400 shrink-0" aria-hidden="true" />
                <h2 className="flex-1 truncate text-sm font-semibold">{props.conversation?.title ?? 'Rucio bot'}</h2>
                <ContextGauge fraction={props.contextFraction} contextWindow={props.contextWindow} />
                <button
                    type="button"
                    className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    aria-label="New chat"
                    onClick={props.onNewChat}
                >
                    <HiPlus className="h-5 w-5" />
                </button>
                <HistoryMenu
                    conversations={props.conversations}
                    currentId={props.conversation?.id}
                    onOpen={props.onOpenConversation}
                    onDelete={props.onDeleteConversation}
                />
                <Link
                    href="/assistant/settings"
                    className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    aria-label="Rucio bot settings"
                >
                    <HiOutlineCog className="h-5 w-5" />
                </Link>
                <button
                    type="button"
                    className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    aria-label="Close Rucio bot"
                    onClick={props.onClose}
                >
                    <HiX className="h-5 w-5" />
                </button>
            </header>
            {!props.persistent && (
                <p className="bg-base-warning-100 dark:bg-base-warning-900/40 px-3 py-2 text-xs text-base-warning-800 dark:text-base-warning-300">
                    History is not saved in this browser. Chats last until you close this tab.
                </p>
            )}
            <div role="status" className="sr-only">
                {announcement}
            </div>
            <div
                data-testid="assistant-scroll"
                className="flex-1 overflow-y-auto px-3 py-4 space-y-4"
                onScroll={event => {
                    const node = event.currentTarget;
                    nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight <= 80;
                }}
            >
                {messages.length === 0
                    ? props.emptyState ?? (
                          <p className="text-sm text-neutral-500 dark:text-neutral-400">
                              Ask about your data, rules or storage. Rucio bot sees the page you are on.
                          </p>
                      )
                    : messages.map(message => <AssistantMessage key={message.id} message={message} detail={props.detail} />)}
                {status === 'error' && props.error && (
                    <div
                        role="alert"
                        className="rounded-md border border-base-error-300 bg-base-error-100 dark:bg-base-error-900/40 px-3 py-2 text-sm text-base-error-700 dark:text-base-error-300"
                    >
                        <p>{props.error}</p>
                        {props.sessionExpired && (
                            <Link href="/auth/login" className="mt-1 mr-3 inline-block font-semibold underline">
                                Log in again
                            </Link>
                        )}
                        <button type="button" className="mt-1 font-semibold underline" onClick={props.onRetry}>
                            Retry
                        </button>
                    </div>
                )}
                {status === 'idle' && endsWithStepLimit(messages) && (
                    <button
                        type="button"
                        className="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-neutral-0 hover:bg-brand-700"
                        onClick={props.onContinue}
                    >
                        Continue
                    </button>
                )}
                <div ref={listEnd} />
            </div>
            <Composer
                busy={busy}
                pageContext={props.pageContext}
                onSend={props.onSend}
                onStop={props.onStop}
                bottomInset={isMobile ? props.keyboardInset : 0}
            />
        </aside>
    );
}
