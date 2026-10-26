import type { ChatMessage, Conversation, MessagePart } from '@/lib/core/entity/assistant/conversation';
import type { AssistantConversationRepositoryPort } from '@/lib/core/port/secondary/assistant-conversation-repository-port';
import { deriveHandleRecords, type HandleRecord } from '@/lib/infrastructure/assistant/message-selectors';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function stripResult(result: unknown): unknown {
    if (!isRecord(result)) return result;
    if (typeof result.handle === 'string' && Array.isArray(result.sample)) {
        const { sample: _sample, ...rest } = result;
        return rest;
    }
    if (Array.isArray(result.rows) && Array.isArray(result.columns) && typeof result.totalRows === 'number') {
        return {
            columns: result.columns,
            totalRows: result.totalRows,
            ...(typeof result.savedAs === 'string' ? { savedAs: result.savedAs } : {}),
            rowsOmitted: true,
        };
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
    const forgetAll = () => states.clear();

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
        deleteConversation: id => {
            states.delete(id);
            return repository.deleteConversation(id);
        },
        deleteAll: async accountKey => {
            forgetAll();
            await repository.deleteAll(accountKey);
        },
        deleteAllAccounts: async () => {
            forgetAll();
            await repository.deleteAllAccounts();
        },
        listMessages: conversationId => repository.listMessages(conversationId),
        saveMessage: message => {
            const stored = stripRowsForStorage(message);
            const state = stateFor(message.conversationId);
            const records = deriveHandleRecords([stored]);
            if (records.length > 0) state.byMessage.set(message.id, records);
            else state.byMessage.delete(message.id);
            return repository.saveMessage(stored);
        },
        deleteMessage: async id => {
            await repository.deleteMessage(id);
            // the stored conversation.handles seed may hold records of this message, so rebuild from the transcript
            await Promise.all(
                Array.from(states.keys()).map(async conversationId => {
                    const messages = await repository.listMessages(conversationId);
                    const state = states.get(conversationId);
                    if (!state) return;
                    state.seed = [];
                    state.byMessage = new Map(
                        messages.map((m): [string, HandleRecord[]] => [m.id, deriveHandleRecords([m])]).filter(([, r]) => r.length > 0),
                    );
                }),
            );
        },
        listAccounts: () => repository.listAccounts(),
        estimateSizes: accountKey => repository.estimateSizes(accountKey),
        enforceRetention: (policy, now, protectedIds) => repository.enforceRetention(policy, now, protectedIds),
    };
    if (repository.onPersistenceLost) wrapped.onPersistenceLost = listener => repository.onPersistenceLost!(listener);
    return wrapped;
}
