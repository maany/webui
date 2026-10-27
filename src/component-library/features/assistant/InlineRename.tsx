'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Conversation } from '@/lib/core/entity/assistant/conversation';
import { CONVERSATION_TITLE_MAX_CHARS, normalizeConversationTitle } from '@/lib/core/services/assistant-conversation-title';

export const renameErrorId = (id: string) => `rename-error-${id}`;
export const RENAME_ERROR = 'Could not rename this chat.';

/** Inline rename state shared by the history menu and the storage settings list. */
export function useInlineRename(onRename?: (id: string, title: string) => void | Promise<void>) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [draft, setDraft] = useState('');
    const [failed, setFailed] = useState(false);
    const editingRef = useRef<string | null>(null);
    const savingRef = useRef(false);
    const pencils = useRef(new Map<string, HTMLButtonElement | null>());
    const [focusBack, setFocusBack] = useState<string | null>(null);

    useEffect(() => {
        if (focusBack === null) return;
        pencils.current.get(focusBack)?.focus();
        setFocusBack(null);
    }, [focusBack]);

    const close = useCallback((id: string) => {
        editingRef.current = null;
        setEditingId(null);
        setFailed(false);
        setFocusBack(id);
    }, []);

    const start = (conversation: Conversation) => {
        editingRef.current = conversation.id;
        setDraft(conversation.title);
        setFailed(false);
        setEditingId(conversation.id);
    };

    const cancel = (id: string) => {
        if (editingRef.current !== id) return;
        close(id);
    };

    const commit = async (conversation: Conversation) => {
        if (editingRef.current !== conversation.id || savingRef.current) return;
        const title = normalizeConversationTitle(draft);
        if (!title) {
            setFailed(true);
            return;
        }
        if (title === conversation.title) {
            close(conversation.id);
            return;
        }
        savingRef.current = true;
        try {
            await onRename?.(conversation.id, title);
        } catch {
            if (editingRef.current === conversation.id) setFailed(true);
            return;
        } finally {
            savingRef.current = false;
        }
        if (editingRef.current === conversation.id) close(conversation.id);
    };

    const registerPencil = (id: string) => (element: HTMLButtonElement | null) => {
        pencils.current.set(id, element);
    };

    return { editingId, draft, setDraft, failed, start, cancel, commit, registerPencil };
}

export function RenameInput({
    conversation,
    rename,
    className,
}: {
    conversation: Conversation;
    rename: ReturnType<typeof useInlineRename>;
    className?: string;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => inputRef.current?.focus(), []);
    return (
        <input
            ref={inputRef}
            type="text"
            aria-label={`Title for ${conversation.title}`}
            aria-invalid={rename.failed ? true : undefined}
            aria-describedby={rename.failed ? renameErrorId(conversation.id) : undefined}
            maxLength={CONVERSATION_TITLE_MAX_CHARS * 2}
            value={rename.draft}
            className={className}
            onChange={event => rename.setDraft(event.target.value)}
            onBlur={() => void rename.commit(conversation)}
            onKeyDown={event => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'Enter') {
                    event.preventDefault();
                    void rename.commit(conversation);
                } else if (event.key === 'Escape') {
                    // Cancels the edit only: the popover and the panel treat a handled Escape as done.
                    event.preventDefault();
                    event.stopPropagation();
                    rename.cancel(conversation.id);
                }
            }}
        />
    );
}
