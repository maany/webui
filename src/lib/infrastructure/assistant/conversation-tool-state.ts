import type { ChatMessage, Conversation, MessagePart } from '@/lib/core/entity/assistant/conversation';
import type { StoredRowsToolResult, StoredSqlResult } from '@/lib/core/entity/assistant/data-handle';
import type { AssistantConversationRepositoryPort } from '@/lib/core/port/secondary/assistant-conversation-repository-port';
import { deriveHandleRecords, type HandleRecord } from '@/lib/infrastructure/assistant/message-selectors';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function isStoredSqlResult(value: unknown): value is StoredSqlResult {
    return isRecord(value) && value.rowsOmitted === true && Array.isArray(value.columns) && typeof value.totalRows === 'number';
}

function stripResult(result: unknown): unknown {
    if (!isRecord(result)) return result;
    // the reducer's trimToolResult output: the preview may hold raw rows, so it is never stored
    if (result.trimmed === true && typeof result.preview === 'string') return { trimmed: true, previewOmitted: true };
    if (typeof result.handle === 'string' && Array.isArray(result.sample)) {
        const stored: StoredRowsToolResult = {
            handle: result.handle,
            rowCount: result.rowCount as number,
            truncated: result.truncated as boolean,
            columns: result.columns as string[],
            ...(result.error !== undefined ? { error: result.error as StoredRowsToolResult['error'] } : {}),
            ...(result.notices !== undefined ? { notices: result.notices as string[] } : {}),
        };
        return stored;
    }
    if (Array.isArray(result.rows) && Array.isArray(result.columns) && typeof result.totalRows === 'number') {
        const stored: StoredSqlResult = {
            columns: result.columns as string[],
            totalRows: result.totalRows,
            ...(typeof result.savedAs === 'string' ? { savedAs: result.savedAs } : {}),
            rowsOmitted: true,
        };
        return stored;
    }
    return result;
}

/** Copy of the message without row data (RowsToolResult.sample, SqlResult.rows); row data never reaches IndexedDB. */
export function stripRowsForStorage(message: ChatMessage): ChatMessage {
    return {
        ...message,
        parts: message.parts.map(
            (part): MessagePart => (part.type === 'tool-call' && part.result !== undefined ? { ...part, result: stripResult(part.result) } : part),
        ),
    };
}

interface HandleState {
    seed?: HandleRecord[];
    byMessage: Map<string, HandleRecord[]>;
}

function mergeRecords(state: HandleState, fallbackSeed: HandleRecord[]): HandleRecord[] {
    const merged = new Map<string, HandleRecord>();
    const all = [...(state.seed ?? fallbackSeed), ...Array.from(state.byMessage.values()).flat()];
    for (const record of all) {
        merged.delete(record.name);
        merged.set(record.name, record);
    }
    return Array.from(merged.values());
}

/**
 * Wraps the conversation repository so every saved conversation carries the find_tools active set and the
 * handle provenance of its transcript. Messages are stored without row data. Handle records are tracked in memory
 * so that saveConversation can write synchronously (awaiting a read first would reopen the delete-resurrection race).
 */
export function withToolState(
    repository: AssistantConversationRepositoryPort,
    activeToolsFor: (conversationId: string) => string[] | undefined,
): AssistantConversationRepositoryPort {
    const states = new Map<string, HandleState>();
    const stateFor = (conversationId: string): HandleState => {
        let state = states.get(conversationId);
        if (!state) {
            state = { byMessage: new Map() };
            states.set(conversationId, state);
        }
        return state;
    };
    const seedFrom = (conversation: Conversation | undefined) => {
        if (!conversation) return;
        const state = stateFor(conversation.id);
        if (state.seed === undefined) state.seed = conversation.handles;
    };

    const wrapped: AssistantConversationRepositoryPort = {
        listConversations: async accountKey => {
            const conversations = await repository.listConversations(accountKey);
            conversations.forEach(seedFrom);
            return conversations;
        },
        getConversation: async id => {
            const conversation = await repository.getConversation(id);
            seedFrom(conversation);
            return conversation;
        },
        saveConversation: conversation => {
            const state = stateFor(conversation.id);
            const activeTools = activeToolsFor(conversation.id) ?? conversation.activeTools;
            return repository.saveConversation({
                ...conversation,
                ...(activeTools !== undefined ? { activeTools } : {}),
                handles: mergeRecords(state, conversation.handles),
            });
        },
        renameConversation: (id, title) => repository.renameConversation(id, title),
        deleteConversation: id => {
            states.delete(id);
            return repository.deleteConversation(id);
        },
        deleteAll: async accountKey => {
            const conversations = await repository.listConversations(accountKey);
            conversations.forEach(conversation => states.delete(conversation.id));
            await repository.deleteAll(accountKey);
        },
        deleteAllAccounts: async () => {
            states.clear();
            await repository.deleteAllAccounts();
        },
        listMessages: conversationId => repository.listMessages(conversationId),
        saveMessage: async message => {
            const stored = stripRowsForStorage(message);
            const state = stateFor(message.conversationId);
            const previous = state.byMessage.get(message.id);
            const records = deriveHandleRecords([stored]);
            if (records.length > 0) state.byMessage.set(message.id, records);
            else state.byMessage.delete(message.id);
            try {
                await repository.saveMessage(stored);
            } catch (error) {
                if (previous) state.byMessage.set(message.id, previous);
                else state.byMessage.delete(message.id);
                throw error;
            }
        },
        deleteMessage: async id => {
            // forget the message at once; a seeded conversation may still hold its records, so those are re-read below
            const seeded: Array<[string, HandleState]> = [];
            states.forEach((state, conversationId) => {
                state.byMessage.delete(id);
                if (state.seed && state.seed.length > 0) seeded.push([conversationId, state]);
            });
            await repository.deleteMessage(id);
            await Promise.all(
                seeded.map(async ([conversationId, state]) => {
                    const messages = await repository.listMessages(conversationId);
                    if (states.get(conversationId) !== state) return;
                    const rebuilt = new Map<string, HandleRecord[]>();
                    for (const m of messages) {
                        const records = deriveHandleRecords([m]);
                        if (records.length > 0) rebuilt.set(m.id, records);
                    }
                    // entries saved while the re-read was in flight are newer and win
                    state.byMessage.forEach((records, messageId) => {
                        rebuilt.delete(messageId);
                        rebuilt.set(messageId, records);
                    });
                    state.seed = [];
                    state.byMessage = rebuilt;
                }),
            );
        },
        listAccounts: () => repository.listAccounts(),
        estimateSizes: accountKey => repository.estimateSizes(accountKey),
        enforceRetention: async (policy, now, protectedIds) => {
            const evicted = await repository.enforceRetention(policy, now, protectedIds);
            evicted.forEach(id => states.delete(id));
            return evicted;
        },
    };
    if (repository.onPersistenceLost) wrapped.onPersistenceLost = listener => repository.onPersistenceLost!(listener);
    return wrapped;
}
