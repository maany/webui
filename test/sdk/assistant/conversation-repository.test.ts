import 'test/fixtures/assistant-indexeddb';
import { deleteDB } from 'idb';
import type { ChatMessage } from '@/lib/core/entity/assistant/conversation';
import type { AssistantConversationRepositoryPort } from '@/lib/core/port/secondary/assistant-conversation-repository-port';
import { InMemoryConversationRepository } from '@/lib/infrastructure/assistant/in-memory-conversation-repository';
import {
    ASSISTANT_DB_NAME,
    createConversationRepository,
    deleteAssistantDatabase,
    IndexedDbConversationRepository,
} from '@/lib/infrastructure/assistant/indexeddb-conversation-repository';
import { makeConversation } from 'test/fixtures/assistant-fixtures';

function message(id: string, conversationId: string, createdAt: string, text = 'hello'): ChatMessage {
    return { id, conversationId, role: 'user', parts: [{ type: 'text', text }], createdAt };
}

const repositories: Array<[string, () => Promise<AssistantConversationRepositoryPort>]> = [
    ['IndexedDbConversationRepository', () => IndexedDbConversationRepository.open()],
    ['InMemoryConversationRepository', async () => new InMemoryConversationRepository()],
];

describe.each(repositories)('%s', (_name, open) => {
    let repository: AssistantConversationRepositoryPort;

    beforeEach(async () => {
        await deleteAssistantDatabase();
        repository = await open();
    });

    afterEach(() => {
        if (repository instanceof IndexedDbConversationRepository) repository.close();
    });

    it('lists only the conversations of an account, newest first', async () => {
        await repository.saveConversation(makeConversation('c1', 'root@def', '2026-10-20T00:00:00.000Z'));
        await repository.saveConversation(makeConversation('c2', 'root@def', '2026-10-22T00:00:00.000Z'));
        await repository.saveConversation(makeConversation('c3', 'jdoe@def', '2026-10-23T00:00:00.000Z'));
        expect((await repository.listConversations('root@def')).map(c => c.id)).toEqual(['c2', 'c1']);
        expect((await repository.getConversation('c3'))?.accountKey).toBe('jdoe@def');
    });

    it('stores messages oldest first, replaces by id and deletes them with the conversation', async () => {
        await repository.saveConversation(makeConversation('c1', 'root@def'));
        await repository.saveMessage(message('m2', 'c1', '2026-10-25T10:00:02.000Z'));
        await repository.saveMessage(message('m1', 'c1', '2026-10-25T10:00:01.000Z'));
        await repository.saveMessage(message('m1', 'c1', '2026-10-25T10:00:01.000Z', 'edited'));
        const listed = await repository.listMessages('c1');
        expect(listed.map(m => m.id)).toEqual(['m1', 'm2']);
        expect(listed[0].parts[0]).toEqual({ type: 'text', text: 'edited' });
        await repository.deleteConversation('c1');
        expect(await repository.getConversation('c1')).toBeUndefined();
        expect(await repository.listMessages('c1')).toEqual([]);
    });

    it('deletes a single message and ignores an unknown id', async () => {
        await repository.saveConversation(makeConversation('c1', 'root@def'));
        await repository.saveMessage(message('m1', 'c1', '2026-10-25T10:00:01.000Z'));
        await repository.saveMessage(message('m2', 'c1', '2026-10-25T10:00:02.000Z'));
        await repository.deleteMessage('m1');
        await repository.deleteMessage('missing');
        expect((await repository.listMessages('c1')).map(m => m.id)).toEqual(['m2']);
    });

    it('deletes all conversations of one account or of every account', async () => {
        await repository.saveConversation(makeConversation('c1', 'root@def'));
        await repository.saveConversation(makeConversation('c2', 'jdoe@def'));
        await repository.deleteAll('root@def');
        expect(await repository.listConversations('root@def')).toEqual([]);
        expect(await repository.listConversations('jdoe@def')).toHaveLength(1);
        await repository.deleteAll();
        expect(await repository.listConversations('jdoe@def')).toEqual([]);
    });

    it('estimates sizes per conversation', async () => {
        await repository.saveConversation(makeConversation('c1', 'root@def'));
        await repository.saveMessage(message('m1', 'c1', '2026-10-25T10:00:01.000Z', 'x'.repeat(1000)));
        const sizes = await repository.estimateSizes('root@def');
        expect(sizes.perConversation.c1).toBeGreaterThan(1000);
        expect(sizes.totalBytes).toBe(sizes.perConversation.c1);
    });

    it('estimates sizes only for the given account', async () => {
        await repository.saveConversation(makeConversation('c1', 'root@def'));
        await repository.saveConversation(makeConversation('c2', 'jdoe@def'));
        await repository.saveMessage(message('m1', 'c2', '2026-10-25T10:00:01.000Z', 'x'.repeat(5000)));
        const sizes = await repository.estimateSizes('root@def');
        expect(Object.keys(sizes.perConversation)).toEqual(['c1']);
        expect(sizes.totalBytes).toBe(sizes.perConversation.c1);
    });

    it('enforces retention by age and returns the deleted ids', async () => {
        await repository.saveConversation(makeConversation('old', 'root@def', '2026-08-01T00:00:00.000Z'));
        await repository.saveConversation(makeConversation('new', 'root@def', '2026-10-24T00:00:00.000Z'));
        const deleted = await repository.enforceRetention(
            { maxAgeDays: 30, maxTotalMB: 50, clearOnLogout: false },
            new Date('2026-10-25T00:00:00.000Z'),
        );
        expect(deleted).toEqual(['old']);
        expect((await repository.listConversations('root@def')).map(c => c.id)).toEqual(['new']);
    });

    it('applies the size budget per account and leaves other accounts alone', async () => {
        const big = 'x'.repeat(600 * 1024);
        const policy = { maxAgeDays: 0, maxTotalMB: 1, clearOnLogout: false };
        await repository.saveConversation(makeConversation('a1', 'a@def', '2026-10-20T00:00:00.000Z'));
        await repository.saveConversation(makeConversation('a2', 'a@def', '2026-10-21T00:00:00.000Z'));
        await repository.saveConversation(makeConversation('b1', 'b@def', '2026-10-01T00:00:00.000Z'));
        await repository.saveMessage(message('ma1', 'a1', '2026-10-20T00:00:01.000Z', big));
        await repository.saveMessage(message('ma2', 'a2', '2026-10-21T00:00:01.000Z', big));
        await repository.saveMessage(message('mb1', 'b1', '2026-10-01T00:00:01.000Z', 'small'));
        const deleted = await repository.enforceRetention(policy, new Date('2026-10-25T00:00:00.000Z'));
        expect(deleted).toEqual(['a1']);
        expect((await repository.listConversations('b@def')).map(c => c.id)).toEqual(['b1']);
        expect((await repository.listConversations('a@def')).map(c => c.id)).toEqual(['a2']);
    });

    it('never evicts a protected conversation, even when it is past the age limit', async () => {
        await repository.saveConversation(makeConversation('open', 'root@def', '2026-08-01T00:00:00.000Z'));
        await repository.saveConversation(makeConversation('old', 'root@def', '2026-08-02T00:00:00.000Z'));
        const deleted = await repository.enforceRetention(
            { maxAgeDays: 30, maxTotalMB: 50, clearOnLogout: false },
            new Date('2026-10-25T00:00:00.000Z'),
            ['open'],
        );
        expect(deleted).toEqual(['old']);
        expect((await repository.listConversations('root@def')).map(c => c.id)).toEqual(['open']);
    });
});

async function withIndexedDb(value: unknown, run: () => Promise<void>): Promise<void> {
    const original = globalThis.indexedDB;
    Object.defineProperty(globalThis, 'indexedDB', { value, configurable: true, writable: true });
    try {
        await run();
    } finally {
        Object.defineProperty(globalThis, 'indexedDB', { value: original, configurable: true, writable: true });
    }
}

/** Another tab deleting the database: fires versionchange on our connection without going through our clear. */
const deleteFromAnotherTab = () => deleteDB(ASSISTANT_DB_NAME);

describe('IndexedDbConversationRepository connection loss', () => {
    beforeEach(async () => {
        await deleteAssistantDatabase();
    });

    it('reopens lazily after another tab deleted the database', async () => {
        const repository = await IndexedDbConversationRepository.open();
        await repository.saveConversation(makeConversation('c1', 'root@def'));
        await deleteFromAnotherTab();
        expect(await repository.listConversations('root@def')).toEqual([]);
        await repository.saveConversation(makeConversation('c2', 'root@def'));
        expect((await repository.listConversations('root@def')).map(c => c.id)).toEqual(['c2']);
        expect(repository.persistent).toBe(true);
        repository.close();
    });

    it('opens once when two operations race the reopen', async () => {
        const repository = await IndexedDbConversationRepository.open();
        await deleteFromAnotherTab();
        const openSpy = jest.spyOn(indexedDB, 'open');
        const [saved, listed] = await Promise.all([
            repository.saveConversation(makeConversation('c1', 'root@def')),
            repository.listConversations('root@def'),
        ]);
        expect(saved).toBeUndefined();
        expect(Array.isArray(listed)).toBe(true);
        expect(openSpy).toHaveBeenCalledTimes(1);
        expect((await repository.listConversations('root@def')).map(c => c.id)).toEqual(['c1']);
        openSpy.mockRestore();
        repository.close();
    });

    it('retries once through the reopen path when the handle was closed under an operation', async () => {
        const repository = await IndexedDbConversationRepository.open();
        // Closed without going through blocking(), so the repository still holds the dead handle.
        (repository as unknown as { db: { close(): void } }).db.close();
        await repository.saveConversation(makeConversation('c1', 'root@def'));
        expect((await repository.listConversations('root@def')).map(c => c.id)).toEqual(['c1']);
        expect(repository.persistent).toBe(true);
        repository.close();
    });

    it('falls back to memory when the lazy reopen times out', async () => {
        const repository = await IndexedDbConversationRepository.open({ openTimeoutMs: 10 });
        await deleteFromAnotherTab();
        await withIndexedDb({ open: () => new IDBOpenDBRequest() }, async () => {
            await repository.saveConversation(makeConversation('c1', 'root@def'));
        });
        expect(repository.persistent).toBe(false);
        expect((await repository.listConversations('root@def')).map(c => c.id)).toEqual(['c1']);
    });

    it('falls back to memory and reports persistent false when the reopen fails', async () => {
        const repository = await IndexedDbConversationRepository.open();
        const lost = jest.fn();
        repository.onPersistenceLost(lost);
        await deleteFromAnotherTab();
        await withIndexedDb(
            {
                open: () => {
                    throw new Error('InvalidStateError');
                },
            },
            async () => {
                await repository.saveConversation(makeConversation('c1', 'root@def'));
            },
        );
        expect(repository.persistent).toBe(false);
        expect(lost).toHaveBeenCalledTimes(1);
        expect((await repository.listConversations('root@def')).map(c => c.id)).toEqual(['c1']);
    });

    it('stops notifying a listener once it unsubscribed', async () => {
        const repository = await IndexedDbConversationRepository.open();
        const lost = jest.fn();
        const unsubscribe = repository.onPersistenceLost(lost);
        unsubscribe();
        await deleteFromAnotherTab();
        await withIndexedDb(
            {
                open: () => {
                    throw new Error('x');
                },
            },
            async () => {
                await repository.saveConversation(makeConversation('c1', 'root@def'));
            },
        );
        expect(lost).not.toHaveBeenCalled();
    });

    it('does not recreate the database when an old repository writes after the clear', async () => {
        const old = await IndexedDbConversationRepository.open();
        await old.saveConversation(makeConversation('c1', 'root@def'));
        await deleteAssistantDatabase();
        await old.saveMessage(message('m1', 'c1', '2026-10-25T10:00:01.000Z'));
        await old.saveConversation(makeConversation('c1', 'root@def'));
        expect(old.persistent).toBe(false);
        const databases = await indexedDB.databases();
        expect(databases.map(database => database.name)).not.toContain(ASSISTANT_DB_NAME);
        const fresh = await IndexedDbConversationRepository.open();
        expect(await fresh.listConversations('root@def')).toEqual([]);
        fresh.close();
    });
});

describe('createConversationRepository', () => {
    it('uses IndexedDB when available', async () => {
        const { repository, persistent } = await createConversationRepository();
        expect(persistent).toBe(true);
        expect(repository).toBeInstanceOf(IndexedDbConversationRepository);
        (repository as IndexedDbConversationRepository).close();
    });

    it('falls back to memory when IndexedDB is missing', async () => {
        await withIndexedDb(undefined, async () => {
            const { repository, persistent } = await createConversationRepository();
            expect(persistent).toBe(false);
            expect(repository).toBeInstanceOf(InMemoryConversationRepository);
        });
    });

    it('falls back to memory when opening IndexedDB throws', async () => {
        await withIndexedDb(
            {
                open: () => {
                    throw new Error('SecurityError');
                },
            },
            async () => {
                const { repository, persistent } = await createConversationRepository();
                expect(persistent).toBe(false);
                expect(repository).toBeInstanceOf(InMemoryConversationRepository);
            },
        );
    });

    it('falls back to memory when opening IndexedDB times out, and closes the connection that opens late', async () => {
        const late = await IndexedDbConversationRepository.open();
        const closeSpy = jest.spyOn(late, 'close');
        let release: (repository: IndexedDbConversationRepository) => void = () => undefined;
        const open = () => new Promise<IndexedDbConversationRepository>(resolve => (release = resolve));
        const { repository, persistent } = await createConversationRepository({ openTimeoutMs: 10, open });
        expect(persistent).toBe(false);
        expect(repository).toBeInstanceOf(InMemoryConversationRepository);
        expect(closeSpy).not.toHaveBeenCalled();
        release(late);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it('deleteAssistantDatabase resolves instead of throwing when deleteDatabase throws', async () => {
        await withIndexedDb(
            {
                deleteDatabase: () => {
                    throw new Error('SecurityError');
                },
            },
            async () => {
                await expect(deleteAssistantDatabase()).resolves.toBeUndefined();
            },
        );
    });

    it('deleteAssistantDatabase resolves after its timeout when the delete never completes', async () => {
        await withIndexedDb({ deleteDatabase: () => new IDBRequest() }, async () => {
            await expect(deleteAssistantDatabase(10)).resolves.toBeUndefined();
        });
    });

    it('deleteAssistantDatabase wipes stored chats even while a connection is open', async () => {
        const repository = await IndexedDbConversationRepository.open();
        await repository.saveConversation(makeConversation('c1', 'root@def'));
        await deleteAssistantDatabase();
        const reopened = await IndexedDbConversationRepository.open();
        expect(await reopened.listConversations('root@def')).toEqual([]);
        reopened.close();
    });
});
