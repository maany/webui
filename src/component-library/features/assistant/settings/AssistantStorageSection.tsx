'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/component-library/atoms/form/button';
import type { Conversation } from '@/lib/core/entity/assistant/conversation';
import type { AssistantSettings, RetentionSettings } from '@/lib/core/entity/assistant/settings';
import type { AssistantConversationRepositoryPort } from '@/lib/core/port/secondary/assistant-conversation-repository-port';
import { conversationToJson, conversationToMarkdown, downloadText, exportFileName } from '@/lib/infrastructure/assistant/conversation-export';
import { createConversationRepository, deleteAssistantDatabase } from '@/lib/infrastructure/assistant/indexeddb-conversation-repository';
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
    /** Accounts other than the current one that have chats in this browser. Hidden when empty. */
    otherAccounts?: Array<{ accountKey: string; conversations: number; bytes: number }>;
    onDeleteAccount?(accountKey: string): void;
    onDeleteAllAccounts?(): void;
    /** Inline failure message from the last delete attempt. */
    error?: string;
}

const LOAD_ERROR = 'Could not load saved chats.';
const RETENTION_LIMITS = { maxAgeDays: { min: 1, max: 3650 }, maxTotalMB: { min: 1, max: 1024 } };

/**
 * Keeps what the user types as text so the field can be cleared and retyped. Whole numbers in range
 * are saved as they are typed; anything else is rounded and clamped on blur or Enter, and an empty
 * field goes back to the saved value.
 */
function RetentionNumberInput({
    label,
    value,
    min,
    max,
    onCommit,
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    onCommit(next: number): void;
}) {
    const [text, setText] = useState(String(value));
    useEffect(() => setText(String(value)), [value]);
    const commit = () => {
        const parsed = Number(text);
        if (text.trim() === '' || !Number.isFinite(parsed)) {
            setText(String(value));
            return;
        }
        const next = Math.min(max, Math.max(min, Math.round(parsed)));
        setText(String(next));
        if (next !== value) onCommit(next);
    };
    return (
        <label className="flex items-center gap-2 text-sm">
            <span className="w-64">{label}</span>
            <input
                type="number"
                min={min}
                max={max}
                step={1}
                value={text}
                onChange={event => {
                    const raw = event.target.value;
                    setText(raw);
                    const parsed = Number(raw);
                    if (raw.trim() !== '' && Number.isInteger(parsed) && parsed >= min && parsed <= max && parsed !== value) onCommit(parsed);
                }}
                onBlur={commit}
                onKeyDown={event => {
                    if (event.key === 'Enter') commit();
                }}
                className="w-24 rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-0 dark:bg-neutral-900 px-2 py-1"
            />
        </label>
    );
}

/** Presentational storage and cleanup controls (spec 9.4). */
export function AssistantStorageView(props: AssistantStorageViewProps) {
    const [confirmAll, setConfirmAll] = useState(false);
    const [confirmAccount, setConfirmAccount] = useState<string | null>(null);
    const [confirmEverything, setConfirmEverything] = useState(false);
    const { retention } = props;
    const otherAccounts = props.otherAccounts ?? [];
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

            {otherAccounts.length > 0 && (
                <div className="space-y-2">
                    <h3 className="text-lg font-semibold">Other accounts in this browser</h3>
                    <ul className="divide-y divide-neutral-200 dark:divide-neutral-800 rounded-md border border-neutral-200 dark:border-neutral-800">
                        {otherAccounts.map(account => (
                            <li key={account.accountKey} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                                <div className="flex-1 min-w-0">
                                    <p className="truncate text-sm font-medium">{account.accountKey}</p>
                                    <p className="text-xs text-neutral-500">
                                        {account.conversations} {account.conversations === 1 ? 'chat' : 'chats'}, {formatBytes(account.bytes)}
                                    </p>
                                </div>
                                {confirmAccount === account.accountKey ? (
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm">Delete these chats?</span>
                                        <Button
                                            size="sm"
                                            variant="error"
                                            aria-label={`Confirm delete of ${account.accountKey}`}
                                            onClick={() => {
                                                setConfirmAccount(null);
                                                props.onDeleteAccount?.(account.accountKey);
                                            }}
                                        >
                                            Delete
                                        </Button>
                                        <Button size="sm" variant="neutral" onClick={() => setConfirmAccount(null)}>
                                            Cancel
                                        </Button>
                                    </div>
                                ) : (
                                    <Button
                                        size="sm"
                                        variant="error"
                                        aria-label={`Delete chats of ${account.accountKey}`}
                                        onClick={() => setConfirmAccount(account.accountKey)}
                                    >
                                        Delete
                                    </Button>
                                )}
                            </li>
                        ))}
                    </ul>
                    {confirmEverything ? (
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm">Delete the Rucio bot chats of every account in this browser, including this one?</span>
                            <Button
                                size="sm"
                                variant="error"
                                onClick={() => {
                                    setConfirmEverything(false);
                                    props.onDeleteAllAccounts?.();
                                }}
                            >
                                Delete everything
                            </Button>
                            <Button size="sm" variant="neutral" onClick={() => setConfirmEverything(false)}>
                                Cancel
                            </Button>
                        </div>
                    ) : (
                        <Button size="sm" variant="error" onClick={() => setConfirmEverything(true)}>
                            Delete Rucio bot data for all accounts
                        </Button>
                    )}
                </div>
            )}

            <fieldset className="space-y-3">
                <legend className="text-lg font-semibold">Retention</legend>
                <RetentionNumberInput
                    label="Delete chats older than (days)"
                    value={retention.maxAgeDays}
                    min={RETENTION_LIMITS.maxAgeDays.min}
                    max={RETENTION_LIMITS.maxAgeDays.max}
                    onCommit={maxAgeDays => props.onRetentionChange({ ...retention, maxAgeDays })}
                />
                <RetentionNumberInput
                    label="Maximum storage per account (MB)"
                    value={retention.maxTotalMB}
                    min={RETENTION_LIMITS.maxTotalMB.min}
                    max={RETENTION_LIMITS.maxTotalMB.max}
                    onCommit={maxTotalMB => props.onRetentionChange({ ...retention, maxTotalMB })}
                />
                <label className="flex items-center gap-2 text-sm">
                    <input
                        type="checkbox"
                        checked={retention.clearOnLogout}
                        onChange={event => props.onRetentionChange({ ...retention, clearOnLogout: event.target.checked })}
                    />
                    Delete my Rucio bot chats when I sign out
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
    const [otherAccounts, setOtherAccounts] = useState<Array<{ accountKey: string; conversations: number; bytes: number }>>([]);
    const [storeEpoch, setStoreEpoch] = useState(0);
    const [error, setError] = useState<string | undefined>(undefined);

    useEffect(() => {
        let cancelled = false;
        let unsubscribe: (() => void) | undefined;
        createConversationRepository()
            .then(result => {
                if (cancelled) return;
                setStore(result);
                unsubscribe = result.repository.onPersistenceLost?.(() =>
                    setStore(current => (current ? { ...current, persistent: false } : current)),
                );
            })
            .catch(() => {
                if (!cancelled) setError(LOAD_ERROR);
            });
        return () => {
            cancelled = true;
            unsubscribe?.();
        };
    }, [storeEpoch]);

    const reload = useCallback(async () => {
        if (!store) {
            if (!accountKey) {
                setConversations([]);
                setSizes({ perConversation: {}, totalBytes: 0 });
                setOtherAccounts([]);
                setError(undefined);
            }
            return;
        }
        try {
            if (accountKey) {
                setConversations(await store.repository.listConversations(accountKey));
                setSizes(await store.repository.estimateSizes(accountKey));
            } else {
                setConversations([]);
                setSizes({ perConversation: {}, totalBytes: 0 });
                setError(undefined);
            }
            setOtherAccounts((await store.repository.listAccounts()).filter(account => account.accountKey !== accountKey));
            if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
                const estimate = await navigator.storage.estimate().catch(() => undefined);
                if (estimate?.usage !== undefined && estimate.quota !== undefined) setBrowserUsage({ usage: estimate.usage, quota: estimate.quota });
            }
            setMemoryBytes(shell.memoryControls ? await shell.memoryControls.memoryBytes() : null);
        } catch {
            setError(LOAD_ERROR);
        }
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

    // Stops a running turn first (it would otherwise save into the deleted database), then drops the whole
    // database and reopens the store: the old connection must not be used after a clear.
    const deleteEverything = async () => {
        setError(undefined);
        try {
            if (shell.conversationControls) await shell.conversationControls.deleteAll();
            await deleteAssistantDatabase();
        } catch {
            setError('Could not delete Rucio bot data.');
            return;
        }
        shell.notifyStorageChanged();
        setStore(null);
        setStoreEpoch(epoch => epoch + 1);
    };

    const freeMemory = async () => {
        if (!shell.memoryControls) return;
        setError(undefined);
        try {
            await shell.memoryControls.freeMemory();
        } catch {
            setError('Could not free memory.');
            return;
        }
        await reload();
    };

    const exportConversation = async (id: string, format: 'md' | 'json') => {
        if (!store) return;
        const conversation = conversations.find(item => item.id === id);
        if (!conversation) return;
        let messages;
        try {
            messages = await store.repository.listMessages(id);
        } catch {
            setError('Could not export this chat.');
            return;
        }
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
            onFreeMemory={() => void freeMemory()}
            otherAccounts={otherAccounts}
            // The open conversation belongs to the current account, so another account is deleted straight from the repository.
            onDeleteAccount={key => void runDelete(async () => store?.repository.deleteAll(key), `Could not delete the chats of ${key}.`)}
            onDeleteAllAccounts={() => void deleteEverything()}
        />
    );
}
