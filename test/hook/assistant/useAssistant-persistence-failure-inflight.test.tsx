import { act, renderHook, waitFor } from '@testing-library/react';
import { z } from 'zod';
import type { ChatMessage, MessagePart } from '@/lib/core/entity/assistant/conversation';
import type { ResolvedProvider } from '@/lib/core/entity/assistant/provider-config';
import type { ToolRisk } from '@/lib/core/entity/assistant/tool';
import { createAssistantEventBus } from '@/lib/infrastructure/assistant/event-bus';
import { InMemoryConversationRepository } from '@/lib/infrastructure/assistant/in-memory-conversation-repository';
import type { AgentRunner, AgentRunnerDeps, RunnerUpdate } from '@/lib/infrastructure/assistant/tanstack-agent-runner';
import { MAY_HAVE_LANDED } from '@/lib/infrastructure/assistant/tool-error';
import { registerTools, resetToolRegistryForTests } from '@/lib/infrastructure/assistant/tool-registry';
import { useAssistantController, type AssistantControllerDeps } from '@/lib/infrastructure/hooks/useAssistant';
import { makeConversation, makeNoopHandles, makePages, makeTool } from 'test/fixtures/assistant-fixtures';

type ToolCallPart = Extract<MessagePart, { type: 'tool-call' }>;

const PROVIDER: ResolvedProvider = {
    providerId: 'operator',
    kind: 'openai-compatible',
    model: 'fake-model',
    baseURL: '/api/assistant/llm',
    via: 'relay',
    contextWindow: 1_000,
};

const ACCOUNT = 'root@def';

function deferred<T = void>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/**
 * A runner shaped like the real one: a background drive loop pushes into a channel, so it keeps going after the
 * controller stops reading. Step one starts `slow_tool` and leaves it in flight; step two runs `quick_write`, whose
 * result save is the one that fails. Once the slow tool settles, the drive loop pushes its late outcome.
 */
function inFlightRunner(deps: () => AgentRunnerDeps, seen: { toolSignal?: AbortSignal; lateOutcomePushed: boolean }) {
    const runner: AgentRunner = {
        run(input) {
            const items: RunnerUpdate[] = [];
            let wake: (() => void) | null = null;
            let closed = false;
            const push = (item: RunnerUpdate) => {
                if (closed) return;
                items.push(item);
                wake?.();
            };
            const drive = async () => {
                const d = deps();
                const slow = d.tools.find(tool => tool.spec.name === 'slow_tool')!;
                push({ type: 'tool-call', toolCallId: 'call-1', toolName: 'slow_tool', args: { id: 'a' }, policy: 'allow' });
                const ctx = d.makeToolContext('call-1', input.turnId);
                seen.toolSignal = ctx.signal;
                const outcome = Promise.resolve(slow.execute({ id: 'a' }, ctx)).then(
                    result => ({ result, error: undefined }),
                    () => ({ result: { ok: true, late: 'outcome-from-slow-tool' }, error: undefined }),
                );
                push({ type: 'tool-call', toolCallId: 'call-2', toolName: 'quick_write', args: { id: 'b' }, policy: 'allow' });
                push({ type: 'tool-result', toolCallId: 'call-2', result: { ok: true }, durationMs: 1 });
                const settled = await outcome;
                push({ type: 'tool-result', toolCallId: 'call-1', result: settled.result, durationMs: 5 });
                seen.lateOutcomePushed = true;
                push({ type: 'text-delta', text: 'late text from the slow tool turn' });
                push({ type: 'finished', status: input.signal.aborted ? 'stopped' : 'completed' });
                closed = true;
                wake?.();
            };
            void drive();
            return (async function* () {
                while (true) {
                    if (items.length > 0) {
                        yield items.shift() as RunnerUpdate;
                        continue;
                    }
                    if (closed) return;
                    await new Promise<void>(resolve => {
                        wake = resolve;
                    });
                    wake = null;
                }
            })();
        },
        resolveApproval: jest.fn(),
    };
    return runner;
}

function setup(slowRisk: ToolRisk, options: { holdSlowTool?: Promise<void> } = {}) {
    const repository = new InMemoryConversationRepository();
    const seen: { toolSignal?: AbortSignal; lateOutcomePushed: boolean } = { lateOutcomePushed: false };
    const slowTool = makeTool('slow_tool', slowRisk, z.object({ id: z.string() }), async (_args, ctx) => {
        // Settles only once the abort reaches it (and, when held, once the test lets it go).
        await new Promise<void>(resolve => {
            if (ctx.signal.aborted) resolve();
            ctx.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        await options.holdSlowTool;
        return { ok: true, late: 'outcome-from-slow-tool' };
    });
    const quickWrite = makeTool('quick_write', 'write', z.object({ id: z.string() }), async () => ({ ok: true }));
    registerTools([slowTool, quickWrite]);
    const bus = createAssistantEventBus();
    const deps: AssistantControllerDeps = {
        accountKey: ACCOUNT,
        repository: Promise.resolve({ repository, persistent: true }),
        resolveProvider: () => PROVIDER,
        visibleTools: () => [slowTool, quickWrite],
        makePolicyFor: () => () => 'allow',
        toolContextExtras: () => ({}),
        pageContext: () => undefined,
        retention: () => ({ maxAgeDays: 30, maxTotalMB: 50, clearOnLogout: false }),
        handles: makeNoopHandles(),
        pages: makePages(),
        bus,
        navigate: jest.fn(),
        queryClient: {} as AssistantControllerDeps['queryClient'],
        createRunner: runnerDeps => inFlightRunner(runnerDeps, seen),
        summarize: jest.fn().mockResolvedValue({ text: '' }),
    };
    const hook = renderHook(() => useAssistantController(deps));
    return { hook, repository, seen };
}

/** True for the save of the assistant message once quick_write's result is in it. */
const isQuickWriteResultSave = (message: ChatMessage) =>
    message.role === 'assistant' && message.parts.some(part => part.type === 'tool-call' && part.toolCallId === 'call-2' && part.status === 'done');

const slowPart = (messages: ChatMessage[]) =>
    messages.flatMap(message => message.parts).find((part): part is ToolCallPart => part.type === 'tool-call' && part.toolCallId === 'call-1');

afterEach(() => {
    resetToolRegistryForTests();
    jest.restoreAllMocks();
});

describe('useAssistantController when a save fails while another tool is in flight', () => {
    it('aborts an in-flight read tool and closes its part as aborted, without the write warning', async () => {
        const { hook, repository, seen } = setup('read');
        jest.spyOn(repository, 'saveMessage').mockImplementation(async message => {
            if (isQuickWriteResultSave(message)) throw new DOMException('quota', 'QuotaExceededError');
        });
        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('look things up');
        });
        await act(async () => {
            await expect(sending).resolves.toBeUndefined();
        });
        await waitFor(() => expect(hook.result.current.status).toBe('error'));
        expect(seen.toolSignal?.aborted).toBe(true);
        const part = slowPart(hook.result.current.messages);
        expect(part).toMatchObject({ status: 'error', error: { error: 'aborted' } });
        expect(part?.error?.message).not.toContain(MAY_HAVE_LANDED);
        expect(hook.result.current.error).toMatch(/could not save this conversation/);
    });

    it('closes an in-flight write with the may-have-landed warning', async () => {
        const { hook, repository, seen } = setup('write');
        jest.spyOn(repository, 'saveMessage').mockImplementation(async message => {
            if (isQuickWriteResultSave(message)) throw new DOMException('quota', 'QuotaExceededError');
        });
        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('change two things');
        });
        await act(async () => {
            await expect(sending).resolves.toBeUndefined();
        });
        await waitFor(() => expect(hook.result.current.status).toBe('error'));
        expect(seen.toolSignal?.aborted).toBe(true);
        const part = slowPart(hook.result.current.messages);
        expect(part).toMatchObject({ status: 'error', error: { error: 'aborted', message: expect.stringContaining(MAY_HAVE_LANDED) } });
        // The finished part is untouched.
        expect(hook.result.current.messages.flatMap(message => message.parts)).toContainEqual(
            expect.objectContaining({ type: 'tool-call', toolCallId: 'call-2', status: 'done' }),
        );
    });

    it('writes nothing of the settling tool into a conversation opened while the turn was stopping', async () => {
        const hold = deferred();
        const { hook, repository, seen } = setup('write', { holdSlowTool: hold.promise });
        const other = makeConversation('conv-other', ACCOUNT);
        const otherMessage: ChatMessage = {
            id: 'other-user-1',
            conversationId: other.id,
            role: 'user',
            parts: [{ type: 'text', text: 'an older question' }],
            createdAt: '2026-10-25T10:00:00.000Z',
        };
        await repository.saveConversation(other);
        await repository.saveMessage(otherMessage);

        const failingSave = deferred();
        const saveStarted = deferred();
        const saved: ChatMessage[] = [];
        const original = repository.saveMessage.bind(repository);
        jest.spyOn(repository, 'saveMessage').mockImplementation(async message => {
            saved.push(message);
            if (isQuickWriteResultSave(message)) {
                saveStarted.resolve();
                await failingSave.promise;
                throw new DOMException('quota', 'QuotaExceededError');
            }
            await original(message);
        });

        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('change two things');
        });
        await act(async () => {
            await saveStarted.promise;
        });
        const turnConversationId = hook.result.current.conversation?.id;
        expect(turnConversationId).toBeDefined();
        expect(turnConversationId).not.toBe(other.id);

        // Switch while the save is still pending and the slow tool has not settled.
        await act(async () => {
            await hook.result.current.openConversation(other.id);
        });
        await act(async () => {
            failingSave.resolve();
            await sending;
        });
        // Now let the slow tool settle, so the runner pushes its late outcome.
        await act(async () => {
            hold.resolve();
            await waitFor(() => expect(seen.lateOutcomePushed).toBe(true));
        });
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 20));
        });

        expect(seen.toolSignal?.aborted).toBe(true);
        expect(hook.result.current.conversation?.id).toBe(other.id);
        expect(hook.result.current.messages).toEqual([otherMessage]);
        expect(await repository.listMessages(other.id)).toEqual([otherMessage]);
        expect(saved.filter(message => message.conversationId === other.id)).toEqual([]);
        expect(JSON.stringify(saved)).not.toContain('outcome-from-slow-tool');
        expect(JSON.stringify(hook.result.current.messages)).not.toContain('late text');
    });
});
