'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/component-library/atoms/form/button';
import type { Conversation } from '@/lib/core/entity/assistant/conversation';
import type { AssistantSettings, RetentionSettings } from '@/lib/core/entity/assistant/settings';
import type { AssistantConversationRepositoryPort } from '@/lib/core/port/secondary/assistant-conversation-repository-port';
import { conversationToJson, conversationToMarkdown, downloadText, exportFileName } from '@/lib/infrastructure/assistant/conversation-export';
import { createConversationRepository } from '@/lib/infrastructure/assistant/indexeddb-conversation-repository';
import { toAccountKey } from '@/lib/infrastructure/assistant/page-context';
import { useAssistantPanel } from '@/lib/infrastructure/hooks/useAssistantShell';
import { formatBytes } from '../format';

export interface AssistantStorageViewProps {
    conversations: Conversation[];
    sizes: Record<string, number>;
    totalBytes: number;
    browserUsage?: { usage: number; quota: number };
    memoryBytes: number | null;
    persistent: boolean;
    retention: RetentionSettings;
    onRetentionChange(next: RetentionSettings): void;
    onExport(id: string, format: 'md' | 'json'): void;
    onDelete(id: string): void;
    onDeleteAll(): void;
    onFreeMemory(): void;
    /** Inline failure message from the last delete attempt. */
    error?: string;
}

/** Presentational storage and cleanup controls (spec 9.4). */
export function AssistantStorageView(props: AssistantStorageViewProps) {
    const [confirmAll, setConfirmAll] = useState(false);
    const { retention } = props;
    return (
        <section aria-labelledby="assistant-conversations-heading" className="space-y-6">
            <div className="space-y-2">
                <h3 id="assistant-conversations-heading" className="text-lg font-semibold">
                    Saved chats
                </h3>
                {!props.persistent && (
                    <p className="text-sm text-base-warning-700 dark:text-base-warning-300">
                        This browser does not allow saving chats. History is kept in memory only.
                    </p>
                )}
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                    {props.conversations.length} {props.conversations.length === 1 ? 'chat' : 'chats'} for this account,{' '}
                    {formatBytes(props.totalBytes)}.
                    {props.browserUsage
                        ? ` This site uses ${formatBytes(props.browserUsage.usage)} of ${formatBytes(props.browserUsage.quota)} in this browser.`
                        : ''}
                </p>
                {props.error && (
                    <p role="alert" className="text-sm text-base-error-700 dark:text-base-error-300">
                        {props.error}
                    </p>
                )}
                {props.conversations.length > 0 && (
                    <ul className="divide-y divide-neutral-200 dark:divide-neutral-800 rounded-md border border-neutral-200 dark:border-neutral-800">
                        {props.conversations.map(conversation => (
                            <li key={conversation.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                                <div className="flex-1 min-w-0">
                                    <p className="truncate text-sm font-medium">{conversation.title}</p>
                                    <p className="text-xs text-neutral-500">
                                        {conversation.updatedAt.slice(0, 10)} · {formatBytes(props.sizes[conversation.id] ?? 0)}
                                    </p>
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        size="sm"
                                        variant="neutral"
                                        onClick={() => props.onExport(conversation.id, 'md')}
                                        aria-label={`Export ${conversation.title} as Markdown`}
                                    >
                                        Markdown
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="neutral"
                                        onClick={() => props.onExport(conversation.id, 'json')}
                                        aria-label={`Export ${conversation.title} as JSON`}
                                    >
                                        JSON
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="error"
                                        onClick={() => props.onDelete(conversation.id)}
                                        aria-label={`Delete ${conversation.title}`}
                                    >
                                        Delete
                                    </Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
                {props.conversations.length > 0 &&
                    (confirmAll ? (
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm">Delete every chat of this account?</span>
                            <Button
                                size="sm"
                                variant="error"
                                onClick={() => {
                                    setConfirmAll(false);
                                    props.onDeleteAll();
                                }}
                            >
                                Delete all
                            </Button>
                            <Button size="sm" variant="neutral" onClick={() => setConfirmAll(false)}>
                                Cancel
                            </Button>
                        </div>
                    ) : (
                        <Button size="sm" variant="error" onClick={() => setConfirmAll(true)}>
                            Delete all chats
                        </Button>
                    ))}
            </div>

            <fieldset className="space-y-3">
                <legend className="text-lg font-semibold">Retention</legend>
                <label className="flex items-center gap-2 text-sm">
                    <span className="w-48">Delete chats older than (days)</span>
                    <input
                        type="number"
                        min={1}
                        max={3650}
                        value={retention.maxAgeDays}
                        onChange={event => props.onRetentionChange({ ...retention, maxAgeDays: Math.max(1, Number(event.target.value) || 1) })}
                        className="w-24 rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-0 dark:bg-neutral-900 px-2 py-1"
                    />
                </label>
                <label className="flex items-center gap-2 text-sm">
                    <span className="w-48">Keep at most (MB)</span>
                    <input
                        type="number"
                        min={1}
                        max={1024}
                        value={retention.maxTotalMB}
                        onChange={event => props.onRetentionChange({ ...retention, maxTotalMB: Math.max(1, Number(event.target.value) || 1) })}
                        className="w-24 rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-0 dark:bg-neutral-900 px-2 py-1"
                    />
                </label>
                <label className="flex items-center gap-2 text-sm">
                    <input
                        type="checkbox"
                        checked={retention.clearOnLogout}
                        onChange={event => props.onRetentionChange({ ...retention, clearOnLogout: event.target.checked })}
                    />
                    Delete all Rucio bot chats when I sign out
                </label>
            </fieldset>

            <div className="space-y-2">
                <h3 className="text-lg font-semibold">Memory</h3>
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                    {props.memoryBytes === null ? 'No data tables are loaded.' : `Data tables use ${formatBytes(props.memoryBytes)}.`}
                </p>
                <Button size="sm" variant="neutral" onClick={props.onFreeMemory} disabled={props.memoryBytes === null}>
                    Free memory now
                </Button>
            </div>
        </section>
    );
}

/** Container: the current account's chats from IndexedDB, retention settings and memory controls. */
export function AssistantStorageSection({
    settings,
    onUpdate,
}: {
    settings: AssistantSettings;
    onUpdate(patch: (settings: AssistantSettings) => AssistantSettings): void;
}) {
    const { data: session } = useSession();
    const accountKey = toAccountKey(session?.user?.rucioAccount, session?.user?.rucioVO);
    const shell = useAssistantPanel();
    const [store, setStore] = useState<{ repository: AssistantConversationRepositoryPort; persistent: boolean } | null>(null);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [sizes, setSizes] = useState<{ perConversation: Record<string, number>; totalBytes: number }>({ perConversation: {}, totalBytes: 0 });
    const [browserUsage, setBrowserUsage] = useState<{ usage: number; quota: number } | undefined>(undefined);
    const [memoryBytes, setMemoryBytes] = useState<number | null>(null);
    const [error, setError] = useState<string | undefined>(undefined);

    useEffect(() => {
        let cancelled = false;
        void createConversationRepository().then(result => {
            if (!cancelled) setStore(result);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const reload = useCallback(async () => {
        if (!store || !accountKey) return;
        setConversations(await store.repository.listConversations(accountKey));
        setSizes(await store.repository.estimateSizes(accountKey));
        if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
            const estimate = await navigator.storage.estimate().catch(() => undefined);
            if (estimate?.usage !== undefined && estimate.quota !== undefined) setBrowserUsage({ usage: estimate.usage, quota: estimate.quota });
        }
        setMemoryBytes(shell.memoryControls ? await shell.memoryControls.memoryBytes() : null);
    }, [store, accountKey, shell.memoryControls]);

    useEffect(() => {
        void reload();
    }, [reload]);

    // Deletes go through the mounted assistant controller when there is one, so a chat that is
    // streaming in the panel is not saved again by its own turn.
    const runDelete = async (action: () => Promise<void>, message: string) => {
        setError(undefined);
        try {
            await action();
        } catch {
            setError(message);
            return;
        }
        shell.notifyStorageChanged();
        await reload();
    };

    const exportConversation = async (id: string, format: 'md' | 'json') => {
        if (!store) return;
        const conversation = conversations.find(item => item.id === id);
        if (!conversation) return;
        const messages = await store.repository.listMessages(id);
        if (format === 'md') downloadText(exportFileName(conversation, 'md'), 'text/markdown', conversationToMarkdown(conversation, messages));
        else downloadText(exportFileName(conversation, 'json'), 'application/json', conversationToJson(conversation, messages));
    };

    return (
        <AssistantStorageView
            conversations={conversations}
            sizes={sizes.perConversation}
            totalBytes={sizes.totalBytes}
            browserUsage={browserUsage}
            memoryBytes={memoryBytes}
            persistent={store?.persistent ?? true}
            retention={settings.retention}
            onRetentionChange={retention => onUpdate(current => ({ ...current, retention }))}
            onExport={(id, format) => void exportConversation(id, format)}
            error={error}
            onDelete={id =>
                void runDelete(async () => {
                    if (shell.conversationControls) await shell.conversationControls.deleteConversation(id);
                    else await store?.repository.deleteConversation(id);
                }, 'Could not delete this chat.')
            }
            onDeleteAll={() =>
                void runDelete(async () => {
                    if (shell.conversationControls) await shell.conversationControls.deleteAll();
                    else if (accountKey) await store?.repository.deleteAll(accountKey);
                }, 'Could not delete chats.')
            }
            onFreeMemory={() => void shell.memoryControls?.freeMemory().then(reload)}
        />
    );
}
