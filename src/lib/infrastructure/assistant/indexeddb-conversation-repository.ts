import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ChatMessage, Conversation } from '@/lib/core/entity/assistant/conversation';
import type { RetentionSettings } from '@/lib/core/entity/assistant/settings';
import type { AssistantConversationRepositoryPort } from '@/lib/core/port/secondary/assistant-conversation-repository-port';
import { jsonBytes, selectConversationsToEvict } from '@/lib/core/services/assistant-retention';
import { InMemoryConversationRepository } from './in-memory-conversation-repository';

export const ASSISTANT_DB_NAME = 'rucio-assistant';
const ASSISTANT_DB_VERSION = 1;
const OPEN_TIMEOUT_MS = 3_000;

interface AssistantDB extends DBSchema {
    conversations: { key: string; value: Conversation; indexes: { byAccount: string } };
    messages: { key: string; value: ChatMessage; indexes: { byConversation: string } };
}

export class IndexedDbConversationRepository implements AssistantConversationRepositoryPort {
    private constructor(private readonly db: IDBPDatabase<AssistantDB>) {}

    static async open(): Promise<IndexedDbConversationRepository> {
        const holder: { db?: IDBPDatabase<AssistantDB> } = {};
        holder.db = await openDB<AssistantDB>(ASSISTANT_DB_NAME, ASSISTANT_DB_VERSION, {
            upgrade(db) {
                const conversations = db.createObjectStore('conversations', { keyPath: 'id' });
                conversations.createIndex('byAccount', 'accountKey');
                const messages = db.createObjectStore('messages', { keyPath: 'id' });
                messages.createIndex('byConversation', 'conversationId');
            },
            // Another tab, or clear on logout, wants to delete or upgrade the database: let it.
            blocking() {
                holder.db?.close();
            },
        });
        return new IndexedDbConversationRepository(holder.db);
    }

    async listConversations(accountKey: string): Promise<Conversation[]> {
        const conversations = await this.db.getAllFromIndex('conversations', 'byAccount', accountKey);
        return conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    async getConversation(id: string): Promise<Conversation | undefined> {
        return this.db.get('conversations', id);
    }

    async saveConversation(conversation: Conversation): Promise<void> {
        await this.db.put('conversations', conversation);
    }

    async deleteConversation(id: string): Promise<void> {
        const tx = this.db.transaction(['conversations', 'messages'], 'readwrite');
        const messageStore = tx.objectStore('messages');
        const messageKeys = await messageStore.index('byConversation').getAllKeys(id);
        await Promise.all([tx.objectStore('conversations').delete(id), ...messageKeys.map(key => messageStore.delete(key))]);
        await tx.done;
    }

    async deleteAll(accountKey?: string): Promise<void> {
        if (accountKey === undefined) {
            const tx = this.db.transaction(['conversations', 'messages'], 'readwrite');
            await Promise.all([tx.objectStore('conversations').clear(), tx.objectStore('messages').clear()]);
            await tx.done;
            return;
        }
        for (const conversation of await this.listConversations(accountKey)) await this.deleteConversation(conversation.id);
    }

    async listMessages(conversationId: string): Promise<ChatMessage[]> {
        const messages = await this.db.getAllFromIndex('messages', 'byConversation', conversationId);
        return messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }

    async saveMessage(message: ChatMessage): Promise<void> {
        await this.db.put('messages', message);
    }

    private async conversationBytes(conversation: Conversation): Promise<number> {
        const messages = await this.listMessages(conversation.id);
        return jsonBytes(conversation) + messages.reduce((sum, message) => sum + jsonBytes(message), 0);
    }

    async estimateSizes(accountKey: string): Promise<{ perConversation: Record<string, number>; totalBytes: number }> {
        const perConversation: Record<string, number> = {};
        let totalBytes = 0;
        for (const conversation of await this.listConversations(accountKey)) {
            const bytes = await this.conversationBytes(conversation);
            perConversation[conversation.id] = bytes;
            totalBytes += bytes;
        }
        return { perConversation, totalBytes };
    }

    async enforceRetention(policy: RetentionSettings, now: Date, protectedIds: readonly string[] = []): Promise<string[]> {
        const conversations = await this.db.getAll('conversations');
        const candidates = await Promise.all(
            conversations.map(async conversation => ({
                id: conversation.id,
                updatedAt: conversation.updatedAt,
                bytes: await this.conversationBytes(conversation),
            })),
        );
        const evicted = selectConversationsToEvict(candidates, policy, now, protectedIds);
        for (const id of evicted) await this.deleteConversation(id);
        return evicted;
    }

    close(): void {
        this.db.close();
    }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('IndexedDB did not open in time')), ms);
        promise.then(
            value => {
                clearTimeout(timer);
                resolve(value);
            },
            error => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

/** IndexedDB when it works, otherwise an in-memory store and `persistent: false` (the panel shows a banner). */
export async function createConversationRepository(): Promise<{ repository: AssistantConversationRepositoryPort; persistent: boolean }> {
    if (typeof indexedDB === 'undefined') return { repository: new InMemoryConversationRepository(), persistent: false };
    try {
        return { repository: await withTimeout(IndexedDbConversationRepository.open(), OPEN_TIMEOUT_MS), persistent: true };
    } catch {
        return { repository: new InMemoryConversationRepository(), persistent: false };
    }
}

/** Deletes every stored conversation of every account (clear on logout). */
export async function deleteAssistantDatabase(): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    await deleteDB(ASSISTANT_DB_NAME);
}
