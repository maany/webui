import type { ChatMessage } from '@/lib/core/entity/assistant/conversation';

/** Compact when the last prompt used more than this share of the context window. */
export const COMPACTION_THRESHOLD = 0.7;
/** Turns (a user message and the reply) kept verbatim after compaction. */
export const KEEP_RECENT_TURNS = 4;

export function shouldCompact(contextFraction: number | null): boolean {
    return contextFraction !== null && contextFraction > COMPACTION_THRESHOLD;
}

export interface CompactionPlan {
    summarize: ChatMessage[];
    keep: ChatMessage[];
    upToMessageId: string;
}

/** Splits the model history into a part to summarise and the last `keepTurns` turns. */
export function planCompaction(messages: ChatMessage[], keepTurns: number = KEEP_RECENT_TURNS): CompactionPlan | undefined {
    const userIndexes = messages.flatMap((message, index) => (message.role === 'user' ? [index] : []));
    if (userIndexes.length <= keepTurns) return undefined;
    const keepFrom = userIndexes[userIndexes.length - keepTurns];
    const summarize = messages.slice(0, keepFrom);
    if (summarize.length === 0) return undefined;
    return { summarize, keep: messages.slice(keepFrom), upToMessageId: summarize[summarize.length - 1].id };
}

/** Messages after the last compacted one; all messages when there was no compaction. */
export function messagesAfter(messages: ChatMessage[], upToMessageId: string | undefined): ChatMessage[] {
    if (!upToMessageId) return messages;
    const index = messages.findIndex(message => message.id === upToMessageId);
    return index < 0 ? messages : messages.slice(index + 1);
}
