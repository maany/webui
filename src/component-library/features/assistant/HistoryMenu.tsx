'use client';

import React, { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { HiOutlineClock, HiOutlineTrash } from 'react-icons/hi';
import type { Conversation } from '@/lib/core/entity/assistant/conversation';
import { cn } from '@/component-library/utils';

export interface HistoryMenuProps {
    conversations: Conversation[];
    currentId?: string;
    onOpen(id: string): void;
    onDelete(id: string): void | Promise<void>;
}

export function HistoryMenu({ conversations, currentId, onOpen, onDelete }: HistoryMenuProps) {
    const [open, setOpen] = useState(false);
    const [deleteFailed, setDeleteFailed] = useState(false);

    const remove = async (id: string) => {
        setDeleteFailed(false);
        try {
            await onDelete(id);
        } catch {
            setDeleteFailed(true);
        }
    };
    return (
        <Popover.Root
            open={open}
            onOpenChange={next => {
                if (next) setDeleteFailed(false);
                setOpen(next);
            }}
        >
            <Popover.Trigger asChild>
                <button type="button" className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="Chat history">
                    <HiOutlineClock className="h-5 w-5" />
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    align="end"
                    sideOffset={4}
                    className="z-60 w-72 max-h-80 overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-0 dark:bg-neutral-900 shadow-lg p-1"
                >
                    {deleteFailed && (
                        <p role="alert" className="px-3 py-2 text-xs text-base-error-700 dark:text-base-error-300">
                            Could not delete this chat.
                        </p>
                    )}
                    {conversations.length === 0 ? (
                        <p className="px-3 py-2 text-sm text-neutral-500">No saved chats yet.</p>
                    ) : (
                        <ul aria-label="Saved chats">
                            {conversations.map(conversation => (
                                <li key={conversation.id} className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        className={cn(
                                            'flex-1 truncate text-left text-sm px-3 py-2 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800',
                                            conversation.id === currentId && 'font-semibold',
                                        )}
                                        onClick={() => {
                                            setOpen(false);
                                            onOpen(conversation.id);
                                        }}
                                    >
                                        {conversation.title}
                                    </button>
                                    <button
                                        type="button"
                                        className="p-1.5 rounded text-neutral-500 hover:text-base-error-600 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                                        aria-label={`Delete chat ${conversation.title}`}
                                        onClick={() => void remove(conversation.id)}
                                    >
                                        <HiOutlineTrash className="h-4 w-4" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
