import { act, renderHook, waitFor } from '@testing-library/react';
import type { ResolvedProvider } from '@/lib/core/entity/assistant/provider-config';
import { createAssistantEventBus } from '@/lib/infrastructure/assistant/event-bus';
import { InMemoryConversationRepository } from '@/lib/infrastructure/assistant/in-memory-conversation-repository';
import type { AgentRunner, AgentRunnerDeps, RunnerUpdate } from '@/lib/infrastructure/assistant/tanstack-agent-runner';
import { useAssistantController, type AssistantControllerDeps } from '@/lib/infrastructure/hooks/useAssistant';
import { makeConversation, makeNoopHandles, makePages } from 'test/fixtures/assistant-fixtures';

const PROVIDER: ResolvedProvider = {
    providerId: 'operator',
    kind: 'openai-compatible',
    model: 'fake-model',
    baseURL: '/api/assistant/llm',
    via: 'relay',
    contextWindow: 1_000,
    pricing: { inputPerMTok: 1, outputPerMTok: 1 },
};

type Script = (input: Parameters<AgentRunner['run']>[0]) => AsyncGenerator<RunnerUpdate>;

function setup(
    script: Script = async function* () {
        yield { type: 'text-delta', text: 'ok' };
        yield { type: 'finished', status: 'completed' };
    },
) {
    const repository = new InMemoryConversationRepository();
    const deps = (accountKey: string): AssistantControllerDeps => ({
        accountKey,
        repository: Promise.resolve({ repository, persistent: true }),
        resolveProvider: () => PROVIDER,
        visibleTools: () => [],
        makePolicyFor: () => () => 'ask',
        toolContextExtras: () => ({}),
        pageContext: () => undefined,
        retention: () => ({ maxAgeDays: 30, maxTotalMB: 50, clearOnLogout: false }),
        handles: makeNoopHandles(),
        pages: makePages(),
        bus: createAssistantEventBus(),
        navigate: jest.fn(),
        queryClient: {} as AssistantControllerDeps['queryClient'],
        createRunner: (_get: () => AgentRunnerDeps): AgentRunner => ({ run: input => script(input), resolveApproval: () => undefined }),
        summarize: jest.fn().mockResolvedValue({ text: 's' }),
    });
    const hook = renderHook(() => useAssistantController(deps('root@def')));
    return { hook, repository };
}

describe('renameConversation', () => {
    it('persists a trimmed, single-line, capped title and keeps updatedAt', async () => {
        const { hook, repository } = setup();
        await repository.saveConversation(makeConversation('c1', 'root@def', '2026-10-24T08:00:00.000Z'));
        await act(async () => {
            await hook.result.current.renameConversation?.('c1', `  my \n chat ${'x'.repeat(100)} `);
        });
        const stored = await repository.getConversation('c1');
        expect(stored?.title.startsWith('my chat xxx')).toBe(true);
        expect(stored?.title.length).toBe(60);
        expect(stored?.updatedAt).toBe('2026-10-24T08:00:00.000Z');
        await waitFor(() => expect(hook.result.current.conversations[0].title).toBe(stored?.title));
    });

    it('refuses an empty title and leaves the stored one', async () => {
        const { hook, repository } = setup();
        await repository.saveConversation(makeConversation('c1', 'root@def'));
        await act(async () => {
            await expect(hook.result.current.renameConversation?.('c1', '  \n ')).rejects.toThrow();
        });
        expect((await repository.getConversation('c1'))?.title).toBe('Conversation c1');
    });

    it('ignores a conversation of another account', async () => {
        const { hook, repository } = setup();
        await repository.saveConversation(makeConversation('c9', 'other@def'));
        await act(async () => {
            await hook.result.current.renameConversation?.('c9', 'hijacked');
        });
        expect((await repository.getConversation('c9'))?.title).toBe('Conversation c9');
    });

    it('updates the open conversation', async () => {
        const { hook, repository } = setup();
        await act(async () => {
            await hook.result.current.send('first question');
        });
        const id = hook.result.current.conversation!.id;
        await act(async () => {
            await hook.result.current.renameConversation?.(id, 'Renamed');
        });
        expect(hook.result.current.conversation?.title).toBe('Renamed');
        expect((await repository.getConversation(id))?.title).toBe('Renamed');
    });

    it('keeps the new title and the turn messages when renamed during a streaming turn', async () => {
        let release: () => void = () => undefined;
        const gated: Script = async function* () {
            yield { type: 'text-delta', text: 'partial' };
            await new Promise<void>(resolve => (release = resolve));
            yield { type: 'text-delta', text: ' done' };
            yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } };
            yield { type: 'finished', status: 'completed' };
        };
        const { hook, repository } = setup(gated);
        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('question');
        });
        await waitFor(() => expect(hook.result.current.status).toBe('streaming'));
        const id = hook.result.current.conversation!.id;
        await act(async () => {
            await hook.result.current.renameConversation?.(id, 'Mid turn');
        });
        await act(async () => {
            release();
            await sending;
        });
        expect((await repository.getConversation(id))?.title).toBe('Mid turn');
        expect(hook.result.current.conversation?.title).toBe('Mid turn');
        const stored = await repository.listMessages(id);
        expect(stored.map(message => message.role)).toEqual(['user', 'assistant']);
        expect(stored[1].parts).toEqual([{ type: 'text', text: 'partial done' }]);
    });

    it('renames with a title-only write, so it never rewrites other fields', async () => {
        const { hook, repository } = setup();
        const saved = jest.spyOn(repository, 'saveConversation');
        await repository.saveConversation(makeConversation('c1', 'root@def'));
        saved.mockClear();
        await act(async () => {
            await hook.result.current.renameConversation?.('c1', 'Atomic');
        });
        expect(saved).not.toHaveBeenCalled();
        expect((await repository.getConversation('c1'))?.title).toBe('Atomic');
    });

    it('does not resurrect a conversation deleted while its rename reads', async () => {
        const { hook, repository } = setup();
        await repository.saveConversation(makeConversation('c1', 'root@def'));
        const realGet = repository.getConversation.bind(repository);
        let releaseGet: () => void = () => undefined;
        jest.spyOn(repository, 'getConversation').mockImplementationOnce(async id => {
            const row = await realGet(id);
            await new Promise<void>(resolve => (releaseGet = resolve));
            return row;
        });
        let renaming!: Promise<void>;
        act(() => {
            renaming = hook.result.current.renameConversation!('c1', 'Late') as Promise<void>;
        });
        await act(async () => {
            await hook.result.current.deleteConversation('c1');
            releaseGet();
            await renaming.catch(() => undefined);
        });
        expect(await repository.getConversation('c1')).toBeUndefined();
    });

    it('surfaces an error when the open conversation is not stored yet', async () => {
        let releaseSave: () => void = () => undefined;
        const { hook, repository } = setup();
        const realSave = repository.saveConversation.bind(repository);
        jest.spyOn(repository, 'saveConversation').mockImplementationOnce(async conversation => {
            await new Promise<void>(resolve => (releaseSave = resolve));
            await realSave(conversation);
        });
        act(() => {
            void hook.result.current.send('first');
        });
        await waitFor(() => expect(hook.result.current.conversation).toBeDefined());
        const id = hook.result.current.conversation!.id;
        await act(async () => {
            await expect(hook.result.current.renameConversation!(id, 'Too early')).rejects.toThrow();
        });
        await act(async () => {
            releaseSave();
        });
    });
});
