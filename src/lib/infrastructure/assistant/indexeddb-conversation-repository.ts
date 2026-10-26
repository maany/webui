import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ChatMessage, Conversation } from '@/lib/core/entity/assistant/conversation';
import type { RetentionSettings } from '@/lib/core/entity/assistant/settings';
import type { AssistantConversationRepositoryPort } from '@/lib/core/port/secondary/assistant-conversation-repository-port';
import { jsonBytes, selectConversationsToEvict } from '@/lib/core/services/assistant-retention';
import { InMemoryConversationRepository } from './in-memory-conversation-repository';

export const ASSISTANT_DB_NAME = 'rucio-assistant';
const ASSISTANT_DB_VERSION = 1;
const OPEN_TIMEOUT_MS = 3_000;
const DELETE_TIMEOUT_MS = 3_000;

interface AssistantDB extends DBSchema {
    conversations: { key: string; value: Conversation; indexes: { byAccount: string } };
    messages: { key: string; value: ChatMessage; indexes: { byConversation: string } };
}

async function openAssistantDb(onBlocking: (db: IDBPDatabase<AssistantDB>) => void): Promise<IDBPDatabase<AssistantDB>> {
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
            if (holder.db) {
                onBlocking(holder.db);
                holder.db.close();
            }
        },
    });
    return holder.db;
}

export class IndexedDbConversationRepository implements AssistantConversationRepositoryPort {
    private db?: IDBPDatabase<AssistantDB>;
    private reopening?: Promise<IDBPDatabase<AssistantDB> | undefined>;
    private fallback?: InMemoryConversationRepository;
    private readonly lostListeners: Array<() => void> = [];

    private constructor(db: IDBPDatabase<AssistantDB>) {
        this.db = db;
    }

    static async open(): Promise<IndexedDbConversationRepository> {
        const repository: { current?: IndexedDbConversationRepository } = {};
        const db = await openAssistantDb(closed => repository.current?.forget(closed));
        repository.current = new IndexedDbConversationRepository(db);
        return repository.current;
    }

    /** False once the connection was lost and could not be reopened: data now lives in memory only. */
    get persistent(): boolean {
        return this.fallback === undefined;
    }

    onPersistenceLost(listener: () => void): void {
        this.lostListeners.push(listener);
    }

    private forget(closed: IDBPDatabase<AssistantDB>): void {
        if (this.db === closed) this.db = undefined;
    }

    /** The live connection, reopened lazily after the browser closed it; undefined once we fell back to memory. */
    private async connection(): Promise<IDBPDatabase<AssistantDB> | undefined> {
        if (this.fallback) return undefined;
        if (this.db) return this.db;
        this.reopening ??= (async () => {
            try {
                this.db = await openAssistantDb(closed => this.forget(closed));
                return this.db;
            } catch {
                this.fallback = new InMemoryConversationRepository();
                this.lostListeners.forEach(listener => listener());
                return undefined;
            } finally {
                this.reopening = undefined;
            }
        })();
        return this.reopening;
    }

    private async run<T>(
        idb: (db: IDBPDatabase<AssistantDB>) => Promise<T>,
        memory: (repository: InMemoryConversationRepository) => Promise<T>,
    ): Promise<T> {
        const db = await this.connection();
        return db ? idb(db) : memory(this.fallback as InMemoryConversationRepository);
    }

    async listConversations(accountKey: string): Promise<Conversation[]> {
        return this.run(
            async db => (await db.getAllFromIndex('conversations', 'byAccount', accountKey)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
            memory => memory.listConversations(accountKey),
        );
    }

    async getConversation(id: string): Promise<Conversation | undefined> {
        return this.run(
            db => db.get('conversations', id),
            memory => memory.getConversation(id),
        );
    }

    async saveConversation(conversation: Conversation): Promise<void> {
        await this.run(
            async db => {
                await db.put('conversations', conversation);
            },
            memory => memory.saveConversation(conversation),
        );
    }

    async deleteConversation(id: string): Promise<void> {
        await this.run(
            async db => {
                const tx = db.transaction(['conversations', 'messages'], 'readwrite');
                const messageStore = tx.objectStore('messages');
                const messageKeys = await messageStore.index('byConversation').getAllKeys(id);
                await Promise.all([tx.objectStore('conversations').delete(id), ...messageKeys.map(key => messageStore.delete(key))]);
                await tx.done;
            },
            memory => memory.deleteConversation(id),
        );
    }

    async deleteAll(accountKey?: string): Promise<void> {
        if (accountKey !== undefined) {
            for (const conversation of await this.listConversations(accountKey)) await this.deleteConversation(conversation.id);
            return;
        }
        await this.run(
            async db => {
                const tx = db.transaction(['conversations', 'messages'], 'readwrite');
                await Promise.all([tx.objectStore('conversations').clear(), tx.objectStore('messages').clear()]);
                await tx.done;
            },
            memory => memory.deleteAll(),
        );
    }

    async listMessages(conversationId: string): Promise<ChatMessage[]> {
        return this.run(
            async db =>
                (await db.getAllFromIndex('messages', 'byConversation', conversationId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
            memory => memory.listMessages(conversationId),
        );
    }

    async saveMessage(message: ChatMessage): Promise<void> {
        await this.run(
            async db => {
                await db.put('messages', message);
            },
            memory => memory.saveMessage(message),
        );
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
        const db = await this.connection();
        if (!db) return (this.fallback as InMemoryConversationRepository).enforceRetention(policy, now, protectedIds);
        const conversations = await db.getAll('conversations');
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
        this.db?.close();
        this.db = undefined;
    }
}

function withTimeout<T>(promise: Promise<T>, ms: number, onLate: (value: T) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            reject(new Error('IndexedDB did not open in time'));
        }, ms);
        promise.then(
            value => {
                clearTimeout(timer);
                if (timedOut) onLate(value);
                else resolve(value);
            },
            error => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

export interface CreateConversationRepositoryOptions {
    openTimeoutMs?: number;
    open?: () => Promise<IndexedDbConversationRepository>;
}

/** IndexedDB when it works, otherwise an in-memory store and `persistent: false` (the panel shows a banner). */
export async function createConversationRepository(
    options: CreateConversationRepositoryOptions = {},
): Promise<{ repository: AssistantConversationRepositoryPort; persistent: boolean }> {
    if (typeof indexedDB === 'undefined') return { repository: new InMemoryConversationRepository(), persistent: false };
    try {
        const open = options.open ?? (() => IndexedDbConversationRepository.open());
        // A connection that opens after the timeout is never used, so close it or it would block later deletes.
        const repository = await withTimeout(open(), options.openTimeoutMs ?? OPEN_TIMEOUT_MS, late => late.close());
        return { repository, persistent: true };
    } catch {
        return { repository: new InMemoryConversationRepository(), persistent: false };
    }
}

/** Deletes every stored conversation of every account (clear on logout). Never throws and never hangs. */
export async function deleteAssistantDatabase(timeoutMs: number = DELETE_TIMEOUT_MS): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            deleteDB(ASSISTANT_DB_NAME),
            new Promise<void>(resolve => {
                timer = setTimeout(resolve, timeoutMs);
            }),
        ]);
    } catch {
        // Best effort: the database may be unavailable or blocked by another tab.
    } finally {
        if (timer) clearTimeout(timer);
    }
}
