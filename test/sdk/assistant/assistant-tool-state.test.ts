import type { ChatMessage, Conversation } from '@/lib/core/entity/assistant/conversation';
import type { AssistantConversationRepositoryPort } from '@/lib/core/port/secondary/assistant-conversation-repository-port';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import { addActiveTools, selectRunTools } from '@/lib/infrastructure/assistant/active-tools';
import { isStoredSqlResult, stripRowsForStorage, withToolState } from '@/lib/infrastructure/assistant/conversation-tool-state';
import { InMemoryConversationRepository } from '@/lib/infrastructure/assistant/in-memory-conversation-repository';
import { applyRunnerUpdate } from '@/lib/infrastructure/assistant/message-reducer';
import { makeConversation } from 'test/fixtures/assistant-fixtures';
import { deriveHandleRecords, hasSessionExpired, referencedHandles } from '@/lib/infrastructure/assistant/message-selectors';

const message = (role: 'user' | 'assistant', parts: ChatMessage['parts'], createdAt = '2026-10-25T10:00:00.000Z'): ChatMessage => ({
    id: `${role}-${createdAt}-${Math.random()}`,
    conversationId: 'c1',
    role,
    parts,
    createdAt,
});

const call = (
    toolName: string,
    args: unknown,
    result: unknown,
    extra: Partial<Extract<ChatMessage['parts'][number], { type: 'tool-call' }>> = {},
) => ({
    type: 'tool-call' as const,
    toolCallId: `${toolName}-${Math.random()}`,
    toolName,
    args,
    policy: 'allow' as const,
    status: 'done' as const,
    result,
    ...extra,
});

describe('deriveHandleRecords', () => {
    it('collects handles from row results and saved queries, latest wins', () => {
        const messages = [
            message('assistant', [call('list_rules', { state: 'Stuck' }, { handle: 'rules_1', rowCount: 3 })], '2026-10-25T10:00:00.000Z'),
            message(
                'assistant',
                [
                    call('run_sql', { sql: 'SELECT * FROM rules_1', save_as: 'stuck' }, { columns: [], rows: [], totalRows: 3, savedAs: 'stuck' }),
                    call('run_sql', { sql: 'SELECT 1' }, { columns: [], rows: [], totalRows: 1 }),
                    call('refresh_handle', { handle: 'rules_1' }, { handle: 'rules_1', rowCount: 4 }),
                    call('list_rules', { state: 'OK' }, { handle: 'rules_2' }, { status: 'error', error: { error: 'timeout', message: 'x' } }),
                    call('list_rules', { state: 'OK' }, { handle: 'rules_1' }),
                ],
                '2026-10-25T11:00:00.000Z',
            ),
        ];
        expect(deriveHandleRecords(messages)).toEqual([
            { name: 'stuck', toolName: 'run_sql', args: { sql: 'SELECT * FROM rules_1', save_as: 'stuck' }, fetchedAt: '2026-10-25T11:00:00.000Z' },
            { name: 'rules_1', toolName: 'list_rules', args: { state: 'OK' }, fetchedAt: '2026-10-25T11:00:00.000Z' },
        ]);
    });
});

describe('referencedHandles', () => {
    it('matches whole names, quoted or not', () => {
        expect(referencedHandles('SELECT * FROM rules_1 JOIN "rses_1" USING (rse)', ['rules_1', 'rses_1', 'rules_10', 'rules'])).toEqual([
            'rules_1',
            'rses_1',
        ]);
    });
});

describe('hasSessionExpired', () => {
    it('looks at the latest assistant message only', () => {
        const expired = message('assistant', [
            call('list_rules', {}, undefined, { status: 'error', error: { error: 'session_expired', message: 'x' } }),
        ]);
        const fine = message('assistant', [{ type: 'text', text: 'ok' }]);
        expect(hasSessionExpired([fine, expired, message('user', [{ type: 'text', text: 'again' }])])).toBe(true);
        expect(hasSessionExpired([expired, fine])).toBe(false);
        expect(hasSessionExpired([])).toBe(false);
    });

    it('treats unauthorized as a session problem too', () => {
        expect(
            hasSessionExpired([
                message('assistant', [call('get_rule', {}, undefined, { status: 'error', error: { error: 'unauthorized', message: 'x' } })]),
            ]),
        ).toBe(true);
    });
});

describe('active tools', () => {
    it('adds names at the end without duplicates and keeps the newest', () => {
        expect(addActiveTools(['a', 'b'], ['b', 'c', 'c'])).toEqual(['a', 'b', 'c']);
        expect(addActiveTools(['a', 'b', 'c'], ['d'], 3)).toEqual(['b', 'c', 'd']);
    });

    it('offers visible tools that are always on or active', () => {
        const tool = (name: string, alwaysOn = false) => ({ spec: { name, alwaysOn } } as unknown as RegisteredTool<unknown>);
        const all = [tool('find_tools', true), tool('list_rules'), tool('list_accounts'), tool('get_rule')];
        const visible = (spec: { name: string }) => spec.name !== 'list_accounts';
        expect(selectRunTools(all, visible, new Set(['list_rules', 'list_accounts'])).map(t => t.spec.name)).toEqual(['find_tools', 'list_rules']);
    });
});

describe('stripRowsForStorage', () => {
    const rowsResult = { handle: 'rules_1', rowCount: 3, truncated: false, columns: ['id'], sample: [{ id: 1 }], notices: ['n'] };
    const sqlResult = { columns: ['id'], rows: [{ id: 1 }], totalRows: 5, savedAs: 'stuck' };

    it('drops the sample of a rows result and the rows of a sql result', () => {
        const original = message('assistant', [
            call('list_rules', {}, rowsResult),
            call('run_sql', { sql: 'x' }, sqlResult),
            { type: 'text', text: 'hi' },
        ]);
        const stripped = stripRowsForStorage(original);
        expect(stripped.parts[0]).toMatchObject({ result: { handle: 'rules_1', rowCount: 3, truncated: false, columns: ['id'], notices: ['n'] } });
        expect((stripped.parts[0] as { result: object }).result).not.toHaveProperty('sample');
        expect((stripped.parts[1] as { result: unknown }).result).toEqual({ columns: ['id'], totalRows: 5, savedAs: 'stuck', rowsOmitted: true });
        expect(stripped.parts[2]).toEqual({ type: 'text', text: 'hi' });
        expect((original.parts[0] as { result: unknown }).result).toBe(rowsResult);
        expect((original.parts[1] as { result: unknown }).result).toBe(sqlResult);
    });

    it('keeps a rows result error and leaves other results alone', () => {
        const error = { error: 'timeout', message: 'x' };
        const other = { total: 4 };
        const stripped = stripRowsForStorage(
            message('assistant', [call('list_rules', {}, { ...rowsResult, error }), call('get_rule', {}, other), call('x', {}, undefined)]),
        );
        expect((stripped.parts[0] as { result: { error: unknown } }).result.error).toBe(error);
        expect((stripped.parts[1] as { result: unknown }).result).toBe(other);
    });
});

describe('deriveHandleRecords on stripped messages', () => {
    it('still finds handles after rows were stripped', () => {
        const stripped = stripRowsForStorage(
            message('assistant', [
                call('list_rules', { a: 1 }, { handle: 'rules_1', rowCount: 1, truncated: false, columns: [], sample: [{ id: 1 }] }),
                call('run_sql', { sql: 's' }, { columns: [], rows: [{ a: 1 }], totalRows: 1, savedAs: 'kept' }),
            ]),
        );
        expect(deriveHandleRecords([stripped]).map(record => record.name)).toEqual(['rules_1', 'kept']);
    });
});

describe('withToolState', () => {
    const listingMessage = (id: string, handle: string, createdAt: string, conversationId = 'c1'): ChatMessage => ({
        ...message('assistant', [call('list_rules', {}, { handle, rowCount: 1, truncated: false, columns: [], sample: [{ id: 1 }] })], createdAt),
        id,
        conversationId,
    });

    function setup() {
        const inner = new InMemoryConversationRepository();
        const saveConversation = jest.spyOn(inner, 'saveConversation');
        const listMessages = jest.spyOn(inner, 'listMessages');
        const saveMessage = jest.spyOn(inner, 'saveMessage');
        const wrapped = withToolState(inner, id => (id === 'c1' ? ['list_rules'] : undefined));
        return { inner, wrapped, saveConversation, listMessages, saveMessage };
    }

    // private helpers of the in-memory class that are not part of the port
    const nonPortHelpers = { conversationBytes: true };

    it('forwards every member of the port', () => {
        const { inner, wrapped } = setup();
        const portMethods = Object.getOwnPropertyNames(InMemoryConversationRepository.prototype).filter(
            name => name !== 'constructor' && !(name in nonPortHelpers),
        );
        expect(
            Object.keys(wrapped)
                .filter(name => name !== 'onPersistenceLost')
                .sort(),
        ).toEqual(portMethods.sort());
        expect('onPersistenceLost' in inner).toBe(false);
        expect('onPersistenceLost' in wrapped).toBe(false);
    });

    it('adds the active set and handle provenance from saved messages when saving', async () => {
        const { inner, wrapped } = setup();
        await wrapped.saveMessage(listingMessage('m1', 'rules_1', '2026-10-25T10:00:00.000Z'));
        await wrapped.saveConversation({ ...makeConversation('c1', 'a'), handles: [] });
        expect(await inner.getConversation('c1')).toMatchObject({
            activeTools: ['list_rules'],
            handles: [{ name: 'rules_1', toolName: 'list_rules', args: {}, fetchedAt: '2026-10-25T10:00:00.000Z' }],
        });
    });

    it('falls back to the conversation activeTools and seeds handles from the stored conversation', async () => {
        const { inner, wrapped } = setup();
        const stored = {
            ...makeConversation('c2', 'a'),
            activeTools: ['keep'],
            handles: [{ name: 'old', toolName: 't', args: {}, fetchedAt: '2026-10-24T00:00:00.000Z' }],
        };
        await inner.saveConversation(stored);
        await wrapped.getConversation('c2');
        await wrapped.saveMessage(listingMessage('m2', 'new_1', '2026-10-25T10:00:00.000Z', 'c2'));
        await wrapped.saveConversation({ ...stored, handles: [] });
        const saved = await inner.getConversation('c2');
        expect(saved?.activeTools).toEqual(['keep']);
        expect(saved?.handles.map(h => h.name)).toEqual(['old', 'new_1']);
    });

    it('seeds from listConversations too', async () => {
        const { inner, wrapped } = setup();
        await inner.saveConversation({ ...makeConversation('c3', 'a'), handles: [{ name: 'old', toolName: 't', args: {}, fetchedAt: 'x' }] });
        await wrapped.listConversations('a');
        await wrapped.saveConversation({ ...makeConversation('c3', 'a'), handles: [] });
        expect((await inner.getConversation('c3'))?.handles.map(h => h.name)).toEqual(['old']);
    });

    it('does not await anything before the underlying conversation write', async () => {
        const { wrapped, saveConversation, listMessages } = setup();
        listMessages.mockImplementation(() => new Promise(() => undefined));
        const pending = wrapped.saveConversation(makeConversation('c1', 'a'));
        expect(saveConversation).toHaveBeenCalledTimes(1);
        await pending;
        expect(listMessages).not.toHaveBeenCalled();
    });

    it('does not resurrect handle records after the conversation was deleted', async () => {
        const { inner, wrapped } = setup();
        await wrapped.saveMessage(listingMessage('m1', 'rules_1', '2026-10-25T10:00:00.000Z'));
        await wrapped.deleteConversation('c1');
        await wrapped.saveConversation({ ...makeConversation('c1', 'a'), handles: [] });
        expect((await inner.getConversation('c1'))?.handles).toEqual([]);
    });

    it('clears records on deleteAll and deleteAllAccounts', async () => {
        const { inner, wrapped } = setup();
        await wrapped.saveConversation(makeConversation('c1', 'a'));
        await wrapped.saveMessage(listingMessage('m1', 'rules_1', '2026-10-25T10:00:00.000Z'));
        await wrapped.deleteAll('a');
        await wrapped.saveConversation({ ...makeConversation('c1', 'a'), handles: [] });
        expect((await inner.getConversation('c1'))?.handles).toEqual([]);
        await wrapped.saveMessage(listingMessage('m2', 'rules_2', '2026-10-25T10:00:00.000Z'));
        await wrapped.deleteAllAccounts();
        await wrapped.saveConversation({ ...makeConversation('c1', 'a'), handles: [] });
        expect((await inner.getConversation('c1'))?.handles).toEqual([]);
    });

    it('drops the handles of a deleted message', async () => {
        const { inner, wrapped } = setup();
        await wrapped.saveMessage(listingMessage('m1', 'rules_1', '2026-10-25T10:00:00.000Z'));
        await wrapped.saveMessage(listingMessage('m2', 'rules_2', '2026-10-25T11:00:00.000Z'));
        await wrapped.deleteMessage('m1');
        await wrapped.saveConversation({ ...makeConversation('c1', 'a'), handles: [] });
        expect((await inner.getConversation('c1'))?.handles.map(h => h.name)).toEqual(['rules_2']);
    });

    it('drops seeded handles that came from a deleted message', async () => {
        const { inner, wrapped } = setup();
        await inner.saveMessage(listingMessage('m1', 'rules_1', '2026-10-25T10:00:00.000Z'));
        await inner.saveConversation({
            ...makeConversation('c1', 'a'),
            handles: [{ name: 'rules_1', toolName: 'list_rules', args: {}, fetchedAt: 'x' }],
        });
        await wrapped.getConversation('c1');
        await wrapped.deleteMessage('m1');
        await wrapped.saveConversation({ ...makeConversation('c1', 'a'), handles: [] });
        expect((await inner.getConversation('c1'))?.handles).toEqual([]);
    });

    it('stores messages without row data and leaves the caller object untouched', async () => {
        const { inner, wrapped } = setup();
        const original = listingMessage('m1', 'rules_1', '2026-10-25T10:00:00.000Z');
        await wrapped.saveMessage(original);
        const [stored] = await inner.listMessages('c1');
        expect((stored.parts[0] as { result: object }).result).not.toHaveProperty('sample');
        expect((original.parts[0] as { result: object }).result).toHaveProperty('sample');
    });

    it('passes protectedIds to enforceRetention', async () => {
        const { inner, wrapped } = setup();
        const spy = jest.spyOn(inner, 'enforceRetention');
        const policy = { maxAgeDays: 30, maxTotalMB: 50, clearOnLogout: false };
        const now = new Date();
        await wrapped.enforceRetention(policy, now, ['c1']);
        expect(spy).toHaveBeenCalledWith(policy, now, ['c1']);
    });

    it('forwards onPersistenceLost and returns its unsubscribe, only when present', () => {
        const unsubscribe = jest.fn();
        const onPersistenceLost = jest.fn(() => unsubscribe);
        const inner = Object.assign(new InMemoryConversationRepository(), { onPersistenceLost });
        const wrapped = withToolState(inner, () => undefined);
        const listener = jest.fn();
        const result = wrapped.onPersistenceLost?.(listener);
        expect(onPersistenceLost).toHaveBeenCalledWith(listener);
        expect(result).toBe(unsubscribe);
    });
});

describe('trimmed results never store a preview', () => {
    const bigSql = () => ({
        columns: ['id', 'payload'],
        rows: Array.from({ length: 50 }, (_, id) => ({ id, payload: 'x'.repeat(600) })),
        totalRows: 50,
        savedAs: 'stuck',
    });

    it('keeps bounded data results intact in the reducer', () => {
        let live = message('assistant', [call('run_sql', { sql: 's', save_as: 'stuck' }, undefined, { status: 'running' })]);
        const toolCallId = (live.parts[0] as { toolCallId: string }).toolCallId;
        const result = bigSql();
        live = applyRunnerUpdate(live, { type: 'tool-result', toolCallId, result, durationMs: 1 });
        expect((live.parts[0] as { result: unknown }).result).toBe(result);
        expect(deriveHandleRecords([live]).map(record => record.name)).toEqual(['stuck']);
    });

    it('still trims other large results in the reducer', () => {
        let live = message('assistant', [call('get_x', {}, undefined, { status: 'running' })]);
        const toolCallId = (live.parts[0] as { toolCallId: string }).toolCallId;
        live = applyRunnerUpdate(live, { type: 'tool-result', toolCallId, result: { big: 'x'.repeat(30000) }, durationMs: 1 });
        expect((live.parts[0] as { result: unknown }).result).toMatchObject({ trimmed: true });
    });

    it('stores a trimmed result without its preview', () => {
        const stored = stripRowsForStorage(message('assistant', [call('run_sql', {}, { preview: '[{"id":1}]', trimmed: true })]));
        expect((stored.parts[0] as { result: unknown }).result).toEqual({ trimmed: true, previewOmitted: true });
    });

    it('stores a large run_sql result as a StoredSqlResult', () => {
        const stored = stripRowsForStorage(message('assistant', [call('run_sql', { sql: 's' }, bigSql())]));
        const result = (stored.parts[0] as { result: unknown }).result;
        expect(isStoredSqlResult(result)).toBe(true);
        expect(JSON.stringify(result)).not.toContain('xxxx');
        expect(result).toEqual({ columns: ['id', 'payload'], totalRows: 50, savedAs: 'stuck', rowsOmitted: true });
        expect(deriveHandleRecords([stored]).map(record => record.name)).toEqual(['stuck']);
        expect(isStoredSqlResult(bigSql())).toBe(false);
    });
});

describe('withToolState state maintenance', () => {
    const listing = (id: string, handle: string, createdAt: string, conversationId = 'c1'): ChatMessage => ({
        ...message('assistant', [call('list_rules', {}, { handle, rowCount: 1, truncated: false, columns: [], sample: [] })], createdAt),
        id,
        conversationId,
    });

    it('restores the previous handle state when the write fails', async () => {
        const inner = new InMemoryConversationRepository();
        const wrapped = withToolState(inner, () => undefined);
        await wrapped.saveMessage(listing('m1', 'rules_1', '2026-10-25T10:00:00.000Z'));
        jest.spyOn(inner, 'saveMessage').mockRejectedValueOnce(new Error('disk'));
        await expect(wrapped.saveMessage(listing('m1', 'rules_9', '2026-10-25T11:00:00.000Z'))).rejects.toThrow('disk');
        await wrapped.saveConversation({ ...makeConversation('c1', 'a'), handles: [] });
        expect((await inner.getConversation('c1'))?.handles.map(h => h.name)).toEqual(['rules_1']);
    });

    it('removes a deleted message handles synchronously', async () => {
        const inner = new InMemoryConversationRepository();
        const wrapped = withToolState(inner, () => undefined);
        await wrapped.saveMessage(listing('m1', 'rules_1', '2026-10-25T10:00:00.000Z'));
        const pending = wrapped.deleteMessage('m1');
        await wrapped.saveConversation({ ...makeConversation('c1', 'a'), handles: [] });
        await pending;
        expect((await inner.getConversation('c1'))?.handles).toEqual([]);
    });

    it('keeps a message saved while a deleteMessage re-read is in flight', async () => {
        const inner = new InMemoryConversationRepository();
        await inner.saveMessage(listing('m1', 'rules_1', '2026-10-25T10:00:00.000Z'));
        await inner.saveConversation({
            ...makeConversation('c1', 'a'),
            handles: [{ name: 'rules_1', toolName: 'list_rules', args: {}, fetchedAt: 'x' }],
        });
        const wrapped = withToolState(inner, () => undefined);
        await wrapped.getConversation('c1');
        const pending = wrapped.deleteMessage('m1');
        await wrapped.saveMessage(listing('m2', 'rules_2', '2026-10-25T12:00:00.000Z'));
        await pending;
        await wrapped.saveConversation({ ...makeConversation('c1', 'a'), handles: [] });
        expect((await inner.getConversation('c1'))?.handles.map(h => h.name)).toEqual(['rules_2']);
    });

    it('drops state of conversations evicted by retention', async () => {
        const inner = new InMemoryConversationRepository();
        const wrapped = withToolState(inner, () => undefined);
        await wrapped.saveConversation({ ...makeConversation('c1', 'a', '2000-01-01T00:00:00.000Z'), handles: [] });
        await wrapped.saveMessage(listing('m1', 'rules_1', '2000-01-01T00:00:00.000Z'));
        const evicted = await wrapped.enforceRetention({ maxAgeDays: 1, maxTotalMB: 50, clearOnLogout: false }, new Date('2026-10-26T00:00:00.000Z'));
        expect(evicted).toEqual(['c1']);
        await wrapped.saveConversation({ ...makeConversation('c1', 'a'), handles: [] });
        expect((await inner.getConversation('c1'))?.handles).toEqual([]);
    });

    it('deleteAll clears state only for that account', async () => {
        const inner = new InMemoryConversationRepository();
        const wrapped = withToolState(inner, () => undefined);
        await wrapped.saveConversation({ ...makeConversation('c1', 'a'), handles: [] });
        await wrapped.saveConversation({ ...makeConversation('c2', 'b'), handles: [] });
        await wrapped.saveMessage(listing('m1', 'rules_1', '2026-10-25T10:00:00.000Z', 'c1'));
        await wrapped.saveMessage(listing('m2', 'rules_2', '2026-10-25T10:00:00.000Z', 'c2'));
        await wrapped.deleteAll('a');
        await wrapped.saveConversation({ ...makeConversation('c1', 'a'), handles: [] });
        await wrapped.saveConversation({ ...makeConversation('c2', 'b'), handles: [] });
        expect((await inner.getConversation('c1'))?.handles).toEqual([]);
        expect((await inner.getConversation('c2'))?.handles.map(h => h.name)).toEqual(['rules_2']);
    });

    it('forwards renameConversation to the repository unchanged', async () => {
        const inner = new InMemoryConversationRepository();
        await inner.saveConversation(makeConversation('c1', 'root@def'));
        const wrapped = withToolState(inner, () => undefined);
        expect(await wrapped.renameConversation('c1', 'Renamed')).toBe(true);
        expect((await inner.getConversation('c1'))?.title).toBe('Renamed');
    });
});
