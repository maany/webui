import { act, renderHook, waitFor } from '@testing-library/react';
import { z } from 'zod';
import type { ResolvedProvider } from '@/lib/core/entity/assistant/provider-config';
import { createAssistantEventBus } from '@/lib/infrastructure/assistant/event-bus';
import { InMemoryConversationRepository } from '@/lib/infrastructure/assistant/in-memory-conversation-repository';
import type { AgentRunner, RunnerUpdate } from '@/lib/infrastructure/assistant/tanstack-agent-runner';
import { registerTools, resetToolRegistryForTests } from '@/lib/infrastructure/assistant/tool-registry';
import { useAssistantController, type AssistantControllerDeps } from '@/lib/infrastructure/hooks/useAssistant';
import { makeNoopHandles, makePages, makeTool } from 'test/fixtures/assistant-fixtures';

const PROVIDER: ResolvedProvider = {
    providerId: 'operator',
    kind: 'openai-compatible',
    model: 'fake-model',
    baseURL: '/api/assistant/llm',
    via: 'relay',
    contextWindow: 1_000,
};

function setup(script: 'finish' | 'approval' = 'finish') {
    const repository = new InMemoryConversationRepository();
    const resolveSpy = jest.fn();
    const runSpy = jest.fn();
    const runner: AgentRunner = {
        async *run(input): AsyncGenerator<RunnerUpdate> {
            runSpy();
            if (script === 'finish') {
                yield { type: 'text-delta', text: 'ok' } as RunnerUpdate;
                yield { type: 'finished', status: 'completed' };
                return;
            }
            yield { type: 'tool-call', toolCallId: 'call-1', toolName: 'do_write', args: { id: 'r1' }, policy: 'ask' };
            yield { type: 'approval-required', toolCallId: 'call-1' };
            await new Promise<void>(resolve => {
                if (input.signal.aborted) resolve();
                input.signal.addEventListener('abort', () => resolve());
            });
            yield { type: 'finished', status: 'stopped' };
        },
        resolveApproval: resolveSpy,
    };
    registerTools([makeTool('do_write', 'write', z.object({ id: z.string() }), async () => ({ ok: true }))]);
    const createRunner = jest.fn(() => runner);
    const resolveProvider = jest.fn(() => PROVIDER);
    let active = true;
    const deps = (): AssistantControllerDeps => ({
        accountKey: 'root@def',
        sessionActive: () => active,
        repository: Promise.resolve({ repository, persistent: true }),
        resolveProvider,
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
        createRunner,
        summarize: jest.fn().mockResolvedValue({ text: '' }),
    });
    const hook = renderHook(() => useAssistantController(deps()));
    return { hook, repository, resolveSpy, runner, runSpy, createRunner, resolveProvider, setActive: (value: boolean) => (active = value) };
}

afterEach(() => {
    resetToolRegistryForTests();
    jest.restoreAllMocks();
});

describe('useAssistantController session gate', () => {
    it('refuses send with no provider lookup, runner, persistence or state change', async () => {
        const { hook, repository, createRunner, resolveProvider, setActive } = setup();
        setActive(false);
        await act(async () => {
            await hook.result.current.send('hello');
        });
        expect(resolveProvider).not.toHaveBeenCalled();
        expect(createRunner).not.toHaveBeenCalled();
        expect(hook.result.current.messages).toEqual([]);
        expect(hook.result.current.status).toBe('idle');
        expect(await repository.listConversations('root@def')).toEqual([]);
    });

    it('refuses retry and continueTurn without a runner call', async () => {
        const { hook, runSpy, setActive } = setup();
        await act(async () => {
            await hook.result.current.send('hello');
        });
        expect(runSpy).toHaveBeenCalledTimes(1);
        const before = hook.result.current.messages;
        setActive(false);
        await act(async () => {
            await hook.result.current.retry?.();
            await hook.result.current.continueTurn?.();
        });
        expect(runSpy).toHaveBeenCalledTimes(1);
        expect(hook.result.current.messages).toBe(before);
    });

    it('refuses resolveApproval and leaves the approval pending until stop expires it', async () => {
        const { hook, resolveSpy, setActive } = setup('approval');
        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('delete r1');
        });
        await waitFor(() => expect(hook.result.current.pendingApprovals).toHaveLength(1));
        setActive(false);
        await act(async () => {
            await hook.result.current.resolveApproval('call-1', 'approved', 'once');
        });
        expect(resolveSpy).not.toHaveBeenCalled();
        expect(hook.result.current.pendingApprovals).toHaveLength(1);
        await act(async () => {
            hook.result.current.stop();
            await sending;
        });
        expect(hook.result.current.pendingApprovals).toHaveLength(0);
        expect(resolveSpy).not.toHaveBeenCalledWith('call-1', true);
    });

    it('sends again once the session is active, with history intact', async () => {
        const { hook, runSpy, setActive } = setup();
        await act(async () => {
            await hook.result.current.send('first');
        });
        setActive(false);
        await act(async () => {
            await hook.result.current.send('blocked');
        });
        expect(runSpy).toHaveBeenCalledTimes(1);
        setActive(true);
        await act(async () => {
            await hook.result.current.send('second');
        });
        expect(runSpy).toHaveBeenCalledTimes(2);
        const texts = hook.result.current.messages.filter(m => m.role === 'user').map(m => (m.parts[0] as { text: string }).text);
        expect(texts).toEqual(['first', 'second']);
    });

    it('does not start the runner when the gate closes while send is still saving', async () => {
        const { hook, repository, runSpy, createRunner, setActive } = setup();
        const original = repository.saveMessage.bind(repository);
        let release: () => void = () => undefined;
        jest.spyOn(repository, 'saveMessage').mockImplementation(async message => {
            await new Promise<void>(resolve => {
                release = resolve;
            });
            await original(message);
        });
        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('hello');
        });
        await waitFor(() => expect(repository.saveMessage).toHaveBeenCalled());
        setActive(false);
        await act(async () => {
            release();
            await sending;
        });
        expect(runSpy).not.toHaveBeenCalled();
        expect(createRunner).not.toHaveBeenCalled();
        expect(hook.result.current.status).toBe('idle');
    });

    it('does not resume the runner when the gate closes while an approval decision is saving', async () => {
        const { hook, repository, resolveSpy, setActive } = setup('approval');
        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('delete r1');
        });
        await waitFor(() => expect(hook.result.current.pendingApprovals).toHaveLength(1));
        const original = repository.saveMessage.bind(repository);
        let release: () => void = () => undefined;
        let held = false;
        jest.spyOn(repository, 'saveMessage').mockImplementation(async message => {
            if (!held && message.parts.some(part => part.type === 'approval')) {
                held = true;
                await new Promise<void>(resolve => {
                    release = resolve;
                });
            }
            await original(message);
        });
        let deciding!: Promise<void>;
        act(() => {
            deciding = hook.result.current.resolveApproval('call-1', 'approved', 'once');
        });
        await waitFor(() => expect(repository.saveMessage).toHaveBeenCalled());
        setActive(false);
        await act(async () => {
            release();
            await deciding;
            hook.result.current.stop();
            await sending;
        });
        expect(resolveSpy).not.toHaveBeenCalledWith('call-1', true);
    });
});
