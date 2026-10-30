import { act, renderHook, waitFor } from '@testing-library/react';
import { z } from 'zod';
import type { ResolvedProvider } from '@/lib/core/entity/assistant/provider-config';
import type { AssistantEvent } from '@/lib/core/entity/assistant/events';
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

/** A runner whose drive loop keeps going on its own, like the real one: only the abort signal stops it. */
function headlessRunner(script: 'approval' | 'text') {
    const seen: { signal?: AbortSignal; modelCallsAfterFailure: number } = { modelCallsAfterFailure: 0 };
    const runner: AgentRunner = {
        async *run(input): AsyncGenerator<RunnerUpdate> {
            seen.signal = input.signal;
            if (script === 'text') {
                yield { type: 'text-delta', text: 'hello' };
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
        resolveApproval: jest.fn(),
    };
    return { runner, seen };
}

function setup(script: 'approval' | 'text') {
    const repository = new InMemoryConversationRepository();
    const { runner, seen } = headlessRunner(script);
    const tool = makeTool('do_write', 'write', z.object({ id: z.string() }), async () => ({ ok: true }));
    registerTools([tool]);
    const bus = createAssistantEventBus();
    const events: AssistantEvent[] = [];
    bus.subscribe(event => events.push(event));
    const deps: AssistantControllerDeps = {
        accountKey: 'root@def',
        repository: Promise.resolve({ repository, persistent: true }),
        resolveProvider: () => PROVIDER,
        visibleTools: () => [tool],
        makePolicyFor: () => () => 'ask',
        toolContextExtras: () => ({}),
        pageContext: () => undefined,
        retention: () => ({ maxAgeDays: 30, maxTotalMB: 50, clearOnLogout: false }),
        handles: makeNoopHandles(),
        pages: makePages(),
        bus,
        navigate: jest.fn(),
        queryClient: {} as AssistantControllerDeps['queryClient'],
        createRunner: () => runner,
        summarize: jest.fn().mockResolvedValue({ text: '' }),
    };
    const hook = renderHook(() => useAssistantController(deps));
    return { hook, repository, seen, events };
}

afterEach(() => {
    resetToolRegistryForTests();
    jest.restoreAllMocks();
});

describe('useAssistantController when a save fails mid-turn (I3)', () => {
    it('aborts the turn and expires the waiting approval when the approval-required save fails', async () => {
        const { hook, repository, seen, events } = setup('approval');
        const original = repository.saveMessage.bind(repository);
        jest.spyOn(repository, 'saveMessage').mockImplementation(async message => {
            if (message.role === 'assistant' && message.parts.some(part => part.type === 'tool-call' && part.status === 'awaiting-approval')) {
                throw new DOMException('quota', 'QuotaExceededError');
            }
            await original(message);
        });
        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('delete rule r1');
        });
        await act(async () => {
            await expect(sending).resolves.toBeUndefined();
        });
        expect(seen.signal?.aborted).toBe(true);
        expect(hook.result.current.status).not.toBe('streaming');
        expect(hook.result.current.pendingApprovals).toEqual([]);
        const assistant = hook.result.current.messages[hook.result.current.messages.length - 1];
        expect(assistant.parts.find(part => part.type === 'tool-call')).toMatchObject({ status: 'expired' });
        expect(events.some(event => event.type === 'turn-finished')).toBe(true);
        expect(hook.result.current.persistent).toBe(false);
        expect(hook.result.current.status).toBe('error');
        expect(hook.result.current.error).toMatch(/could not save this conversation/);
    });

    it('never leaves the status at streaming when the final message save fails', async () => {
        const { hook, repository, events } = setup('text');
        jest.spyOn(repository, 'saveMessage').mockImplementation(async message => {
            if (message.role === 'assistant') throw new DOMException('quota', 'QuotaExceededError');
        });
        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('hi');
        });
        await act(async () => {
            await expect(sending).resolves.toBeUndefined();
        });
        await waitFor(() => expect(hook.result.current.status).toBe('idle'));
        expect(events.filter(event => event.type === 'turn-finished')).toHaveLength(1);
        expect(hook.result.current.persistent).toBe(false);
        const assistant = hook.result.current.messages[hook.result.current.messages.length - 1];
        expect(assistant.parts).toContainEqual(expect.objectContaining({ type: 'text', text: 'hello' }));
    });

    it('never leaves the status at streaming when the conversation save after the turn fails', async () => {
        const { hook, repository, events } = setup('text');
        const original = repository.saveConversation.bind(repository);
        let calls = 0;
        jest.spyOn(repository, 'saveConversation').mockImplementation(async conversation => {
            calls += 1;
            // The first save creates the conversation in send(); the tail save is the second one.
            if (calls > 1) throw new DOMException('gone', 'InvalidStateError');
            await original(conversation);
        });
        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('hi');
        });
        await act(async () => {
            await expect(sending).resolves.toBeUndefined();
        });
        await waitFor(() => expect(hook.result.current.status).toBe('idle'));
        expect(events.filter(event => event.type === 'turn-finished')).toHaveLength(1);
        expect(hook.result.current.persistent).toBe(false);
    });
});
