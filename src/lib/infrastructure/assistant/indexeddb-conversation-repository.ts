import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
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

async function openAssistantDb(onBlocking: (db: IDBPDatabase<AssistantDB>) => void): Promise<IDBPDatabase<AssistantDB>> {
    const holder: { db?: IDBPDatabase<AssistantDB> } = {};
    holder.db = await openDB<AssistantDB>(ASSISTANT_DB_NAME, ASSISTANT_DB_VERSION, {
        upgrade(db) {
            const conversations = db.createObjectStore('conversations', { keyPath: 'id' });
            conversations.createIndex('byAccount', 'accountKey');
            const messages = db.createObjectStore('messages', { keyPath: 'id' });
            messages.createIndex('byConversation', 'conversationId');
        },
        // Another tab, or a clear of all accounts, wants to delete or upgrade the database: let it.
        blocking() {
            if (holder.db) {
                onBlocking(holder.db);
                holder.db.close();
            }
        },
    });
    return holder.db;
}

function isInvalidState(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'InvalidStateError';
}

export interface IndexedDbRepositoryOptions {
    openTimeoutMs?: number;
}

export class IndexedDbConversationRepository implements AssistantConversationRepositoryPort {
    private db?: IDBPDatabase<AssistantDB>;
    private reopening?: Promise<IDBPDatabase<AssistantDB> | undefined>;
    private fallback?: InMemoryConversationRepository;
    private readonly lostListeners = new Set<() => void>();

    private constructor(db: IDBPDatabase<AssistantDB>, private readonly openTimeoutMs: number) {
        this.db = db;
    }

    static async open(options: IndexedDbRepositoryOptions = {}): Promise<IndexedDbConversationRepository> {
        const repository: { current?: IndexedDbConversationRepository } = {};
        const db = await openAssistantDb(closed => repository.current?.forget(closed));
        repository.current = new IndexedDbConversationRepository(db, options.openTimeoutMs ?? OPEN_TIMEOUT_MS);
        return repository.current;
    }

    /** False once the connection was lost and could not be reopened: data now lives in memory only. */
    get persistent(): boolean {
        return this.fallback === undefined;
    }

    /** Returns a function that removes the listener again. */
    onPersistenceLost(listener: () => void): () => void {
        this.lostListeners.add(listener);
        return () => {
            this.lostListeners.delete(listener);
        };
    }

    private forget(closed: IDBPDatabase<AssistantDB>): void {
        if (this.db === closed) this.db = undefined;
    }

    private degrade(): void {
        if (this.fallback) return;
        this.fallback = new InMemoryConversationRepository();
        Array.from(this.lostListeners).forEach(listener => listener());
    }

    /** The live connection, reopened lazily after the browser closed it; undefined once we fell back to memory. */
    private async connection(): Promise<IDBPDatabase<AssistantDB> | undefined> {
        if (this.fallback) return undefined;
        if (this.db) return this.db;
        this.reopening ??= (async () => {
            try {
                const db = await withTimeout(
                    openAssistantDb(closed => this.forget(closed)),
                    this.openTimeoutMs,
                    late => late.close(),
                );
                this.db = db;
                return db;
            } catch {
                this.degrade();
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
        let db = await this.connection();
        if (db) {
            try {
                return await idb(db);
            } catch (error) {
                if (!isInvalidState(error)) throw error;
                // blocking() closed this handle under the operation: reopen and try once more.
                this.forget(db);
                db = await this.connection();
                if (db) return idb(db);
            }
        }
        return memory(this.fallback as InMemoryConversationRepository);
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

    async deleteAll(accountKey: string): Promise<void> {
        for (const conversation of await this.listConversations(accountKey)) await this.deleteConversation(conversation.id);
    }

    async deleteAllAccounts(): Promise<void> {
        await this.run(
            async db => {
                const tx = db.transaction(['conversations', 'messages'], 'readwrite');
                await Promise.all([tx.objectStore('conversations').clear(), tx.objectStore('messages').clear()]);
                await tx.done;
            },
            memory => memory.deleteAllAccounts(),
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

    async deleteMessage(id: string): Promise<void> {
        await this.run(
            db => db.delete('messages', id),
            memory => memory.deleteMessage(id),
        );
    }

    private async conversationBytes(conversation: Conversation): Promise<number> {
        const messages = await this.listMessages(conversation.id);
        return jsonBytes(conversation) + messages.reduce((sum, message) => sum + jsonBytes(message), 0);
    }

    async listAccounts(): Promise<Array<{ accountKey: string; conversations: number; bytes: number }>> {
        const conversations = await this.run<Conversation[] | null>(
            db => db.getAll('conversations'),
            async () => null,
        );
        if (conversations === null) return (this.fallback as InMemoryConversationRepository).listAccounts();
        const totals = new Map<string, { conversations: number; bytes: number }>();
        for (const conversation of conversations) {
            const total = totals.get(conversation.accountKey) ?? { conversations: 0, bytes: 0 };
            total.conversations += 1;
            total.bytes += await this.conversationBytes(conversation);
            totals.set(conversation.accountKey, total);
        }
        return Array.from(totals, ([accountKey, total]) => ({ accountKey, ...total })).sort((a, b) => a.accountKey.localeCompare(b.accountKey));
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
        const conversations = await this.run<Conversation[] | null>(
            db => db.getAll('conversations'),
            async () => null,
        );
        if (conversations === null) return (this.fallback as InMemoryConversationRepository).enforceRetention(policy, now, protectedIds);
        const candidates = await Promise.all(
            conversations.map(async conversation => ({
                id: conversation.id,
                accountKey: conversation.accountKey,
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
        const openTimeoutMs = options.openTimeoutMs ?? OPEN_TIMEOUT_MS;
        const open = options.open ?? (() => IndexedDbConversationRepository.open({ openTimeoutMs }));
        // A connection that opens after the timeout is never used, so close it or it would block later deletes.
        const repository = await withTimeout(open(), openTimeoutMs, late => late.close());
        return { repository, persistent: true };
    } catch {
        return { repository: new InMemoryConversationRepository(), persistent: false };
    }
}
