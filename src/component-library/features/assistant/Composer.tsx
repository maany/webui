'use client';

import React, { useState } from 'react';
import { HiPaperAirplane, HiStop, HiX } from 'react-icons/hi';
import type { PageContext } from '@/lib/core/entity/assistant/page-context';
import { cn } from '@/component-library/utils';

export interface ComposerProps {
    busy: boolean;
    pageContext?: PageContext;
    onSend(text: string, attachPageContext: boolean): void;
    onStop(): void;
    bottomInset?: number;
}

/** Textarea, Send or Stop, and the page context chip. Enter sends, Shift+Enter adds a line. */
export function Composer({ busy, pageContext, onSend, onStop, bottomInset = 0 }: ComposerProps) {
    const [text, setText] = useState('');
    const [attach, setAttach] = useState(true);

    const submit = () => {
        const trimmed = text.trim();
        if (!trimmed || busy) return;
        onSend(trimmed, attach && pageContext !== undefined);
        setText('');
        setAttach(true);
    };

    return (
        <form
            className="border-t border-neutral-200 dark:border-neutral-800 p-3 space-y-2"
            style={{ paddingBottom: `calc(0.75rem + env(safe-area-inset-bottom) + ${bottomInset}px)` }}
            onSubmit={event => {
                event.preventDefault();
                submit();
            }}
        >
            {pageContext && (
                <div className="flex">
                    {attach ? (
                        <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 text-xs text-neutral-700 dark:text-neutral-300">
                            <span className="truncate">Page: {pageContext.title || pageContext.route}</span>
                            <button
                                type="button"
                                className="rounded-full p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                                aria-label="Do not attach this page"
                                onClick={() => setAttach(false)}
                            >
                                <HiX className="h-3 w-3" />
                            </button>
                        </span>
                    ) : (
                        <button type="button" className="text-xs text-brand-600 dark:text-brand-400 hover:underline" onClick={() => setAttach(true)}>
                            Attach this page
                        </button>
                    )}
                </div>
            )}
            <div className="flex items-end gap-2">
                <label htmlFor="assistant-composer" className="sr-only">
                    Message Rucio bot
                </label>
                <textarea
                    id="assistant-composer"
                    rows={2}
                    value={text}
                    placeholder="Ask Rucio bot"
                    onChange={event => setText(event.target.value)}
                    onKeyDown={event => {
                        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                            event.preventDefault();
                            submit();
                        }
                    }}
                    className={cn(
                        'flex-1 resize-none rounded-md border border-neutral-300 dark:border-neutral-700 bg-neutral-0 dark:bg-neutral-900',
                        'px-3 py-2 text-base md:text-sm text-neutral-900 dark:text-neutral-100 focus:outline-hidden focus:ring-2 focus:ring-brand-500',
                    )}
                />
                {busy ? (
                    <button
                        type="button"
                        onClick={onStop}
                        aria-label="Stop"
                        className="h-10 w-10 shrink-0 flex items-center justify-center rounded-md bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600"
                    >
                        <HiStop className="h-5 w-5" />
                    </button>
                ) : (
                    <button
                        type="submit"
                        aria-label="Send"
                        disabled={!text.trim()}
                        className="h-10 w-10 shrink-0 flex items-center justify-center rounded-md bg-brand-600 text-neutral-0 hover:bg-brand-700 disabled:opacity-50"
                    >
                        <HiPaperAirplane className="h-5 w-5 rotate-90" />
                    </button>
                )}
            </div>
        </form>
    );
}
