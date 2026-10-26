import { act, renderHook, waitFor } from '@testing-library/react';
import { z } from 'zod';
import type { ResolvedProvider } from '@/lib/core/entity/assistant/provider-config';
import type { AssistantEvent } from '@/lib/core/entity/assistant/events';
import { createAssistantEventBus } from '@/lib/infrastructure/assistant/event-bus';
import { InMemoryConversationRepository } from '@/lib/infrastructure/assistant/in-memory-conversation-repository';
import { CONTEXT_OVERFLOW_ERROR, SESSION_EXPIRED_ERROR } from '@/lib/infrastructure/assistant/runner-errors';
import type { AgentRunner, AgentRunnerDeps, RunnerUpdate } from '@/lib/infrastructure/assistant/tanstack-agent-runner';
import { useAssistantController, type AssistantControllerDeps } from '@/lib/infrastructure/hooks/useAssistant';
import { makeConversation, makeNoopHandles, makePages, makeTool } from 'test/fixtures/assistant-fixtures';

const PROVIDER: ResolvedProvider = {
    providerId: 'operator',
    kind: 'openai-compatible',
    model: 'fake-model',
    baseURL: '/api/assistant/llm',
    via: 'relay',
    contextWindow: 1_000,
    pricing: { inputPerMTok: 1, outputPerMTok: 1 },
};

type Script = (input: Parameters<AgentRunner['run']>[0], runner: ScriptedRunner) => AsyncGenerator<RunnerUpdate>;

interface ScriptedRunner extends AgentRunner {
    approvals: Map<string, (approved: boolean) => void>;
    lastDeps?: AgentRunnerDeps;
    inputs: Parameters<AgentRunner['run']>[0][];
}

function scriptedRunnerFactory(scripts: Script[]) {
    const created: ScriptedRunner[] = [];
    const createRunner = (deps: () => AgentRunnerDeps): AgentRunner => {
        const script = scripts[Math.min(created.length, scripts.length - 1)];
        const runner: ScriptedRunner = {
            approvals: new Map(),
            inputs: [],
            run(input) {
                runner.lastDeps = deps();
                runner.inputs.push(input);
                return script(input, runner);
            },
            resolveApproval(toolCallId, approved) {
                runner.approvals.get(toolCallId)?.(approved);
            },
        };
        created.push(runner);
        return runner;
    };
    return { createRunner, created };
}

const textScript = (text: string, inputTokens = 100): Script =>
    async function* () {
        yield { type: 'text-delta', text };
        yield { type: 'usage', usage: { inputTokens, outputTokens: 10 } };
        yield { type: 'finished', status: 'completed' };
    };

const approvalScript: Script = async function* (input, runner) {
    yield { type: 'tool-call', toolCallId: 'call-1', toolName: 'do_write', args: { id: 'r1' }, policy: 'ask' };
    yield { type: 'approval-required', toolCallId: 'call-1' };
    const approved = await new Promise<boolean | 'aborted'>(resolve => {
        runner.approvals.set('call-1', resolve);
        if (input.signal.aborted) resolve('aborted');
        input.signal.addEventListener('abort', () => resolve('aborted'));
    });
    if (approved === 'aborted') {
        yield { type: 'finished', status: 'stopped' };
        return;
    }
    yield approved
        ? { type: 'tool-result', toolCallId: 'call-1', result: { ok: true }, durationMs: 5 }
        : { type: 'tool-result', toolCallId: 'call-1', result: null, error: { error: 'rejected_by_user', message: 'no' }, durationMs: 0 };
    yield { type: 'text-delta', text: approved ? 'Done.' : 'Not changed.' };
    yield { type: 'finished', status: 'completed' };
};

function setup(scripts: Script[], overrides: Partial<AssistantControllerDeps> = {}) {
    const repository = new InMemoryConversationRepository();
    const handles = makeNoopHandles();
    const bus = createAssistantEventBus();
    const events: AssistantEvent[] = [];
    bus.subscribe(event => events.push(event));
    const { createRunner, created } = scriptedRunnerFactory(scripts);
    const summarize = jest.fn().mockResolvedValue({ text: 'Summary of older turns.' });
    const tool = makeTool('do_write', 'write', z.object({ id: z.string() }), async () => ({ ok: true }));
    const baseDeps = (accountKey: string): AssistantControllerDeps => ({
        accountKey,
        repository: Promise.resolve({ repository, persistent: true }),
        resolveProvider: () => PROVIDER,
        visibleTools: () => [tool],
        makePolicyFor: getAllow => name => getAllow().has(name) ? 'allow' : 'ask',
        toolContextExtras: () => ({}),
        pageContext: () => ({ route: '/rules', params: { state: 'STUCK' }, title: 'Rules', accountKey }),
        retention: () => ({ maxAgeDays: 30, maxTotalMB: 50, clearOnLogout: false }),
        handles,
        pages: makePages(),
        bus,
        navigate: jest.fn(),
        queryClient: {} as AssistantControllerDeps['queryClient'],
        createRunner,
        summarize,
        ...overrides,
    });
    const hook = renderHook(({ accountKey }: { accountKey: string }) => useAssistantController(baseDeps(accountKey)), {
        initialProps: { accountKey: 'root@def' },
    });
    return { hook, repository, handles, events, created, summarize };
}

describe('useAssistantController', () => {
    it('goes idle -> streaming -> idle and persists the conversation with usage', async () => {
        let release: () => void = () => undefined;
        const gated: Script = async function* () {
            yield { type: 'text-delta', text: 'Hi' };
            await new Promise<void>(resolve => (release = resolve));
            yield { type: 'usage', usage: { inputTokens: 400, outputTokens: 20 } };
            yield { type: 'finished', status: 'completed' };
        };
        const { hook, repository, events } = setup([gated]);
        expect(hook.result.current.status).toBe('idle');
        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('How many rules are stuck?');
        });
        await waitFor(() => expect(hook.result.current.status).toBe('streaming'));
        await act(async () => {
            release();
            await sending;
        });
        const result = hook.result.current;
        expect(result.status).toBe('idle');
        expect(result.messages.map(message => message.role)).toEqual(['user', 'assistant']);
        expect(result.messages[0].parts).toContainEqual({ type: 'page-context', context: expect.objectContaining({ route: '/rules' }) });
        expect(result.messages[1].parts).toEqual([{ type: 'text', text: 'Hi' }]);
        expect(result.contextFraction).toBeCloseTo(0.4);
        expect(result.conversation?.usage).toMatchObject({ inputTokens: 400, outputTokens: 20, turns: 1 });
        const stored = await repository.listConversations('root@def');
        expect(stored).toHaveLength(1);
        expect(await repository.listMessages(stored[0].id)).toHaveLength(2);
        expect(events.map(event => event.type)).toEqual(['turn-started', 'turn-finished']);
    });

    it('waits in awaiting-approval until resolveApproval and records the decision', async () => {
        const { hook, created } = setup([approvalScript]);
        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('delete rule r1');
        });
        await waitFor(() => expect(hook.result.current.status).toBe('awaiting-approval'));
        expect(hook.result.current.pendingApprovals).toEqual([
            { toolCallId: 'call-1', toolName: 'do_write', args: { id: 'r1' }, summary: 'Run do_write', risk: 'write', allowConversationScope: true },
        ]);
        await act(async () => {
            hook.result.current.resolveApproval('call-1', 'approved', 'conversation');
            await sending;
        });
        const result = hook.result.current;
        expect(result.status).toBe('idle');
        expect(result.pendingApprovals).toEqual([]);
        expect(result.conversation?.conversationAllow).toEqual(['do_write']);
        expect(result.messages[1].parts).toContainEqual(
            expect.objectContaining({ type: 'approval', toolCallId: 'call-1', decision: 'approved', approver: 'root@def' }),
        );
        expect(created[0].lastDeps?.policyFor('do_write')).toBe('allow');
    });

    it('closes the conversation, drops handles and discards approvals when the account switches mid-turn', async () => {
        const { hook, repository, handles } = setup([approvalScript]);
        await repository.saveConversation(makeConversation('other-1', 'jdoe@def'));
        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('delete rule r1');
        });
        await waitFor(() => expect(hook.result.current.pendingApprovals).toHaveLength(1));
        // Rerender first so the account effect runs and aborts the turn, then wait for the turn to end.
        act(() => {
            hook.rerender({ accountKey: 'jdoe@def' });
        });
        await act(async () => {
            await sending;
        });
        await waitFor(() => expect(hook.result.current.conversations.map(item => item.id)).toEqual(['other-1']));
        const result = hook.result.current;
        expect(result.conversation).toBeUndefined();
        expect(result.messages).toEqual([]);
        expect(result.pendingApprovals).toEqual([]);
        expect(result.status).toBe('idle');
        expect(handles.dropAll).toHaveBeenCalled();
        const rootConversations = await repository.listConversations('root@def');
        const stored = await repository.listMessages(rootConversations[0].id);
        const toolPart = stored[1].parts.find(part => part.type === 'tool-call');
        expect(toolPart).toMatchObject({ status: 'expired' });
        expect(stored[1].parts).toContainEqual(expect.objectContaining({ type: 'approval', toolCallId: 'call-1', decision: 'expired' }));
    });

    it('stop() aborts the turn and keeps the partial answer', async () => {
        const hanging: Script = async function* (input) {
            yield { type: 'text-delta', text: 'Partial' };
            await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve()));
            yield { type: 'finished', status: 'stopped' };
        };
        const { hook } = setup([hanging]);
        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('long question');
        });
        await waitFor(() => expect(hook.result.current.messages[1]?.parts[0]).toEqual({ type: 'text', text: 'Partial' }));
        await act(async () => {
            hook.result.current.stop();
            await sending;
        });
        expect(hook.result.current.status).toBe('idle');
        expect(hook.result.current.messages[1].parts).toContainEqual({ type: 'notice', level: 'info', text: 'Stopped.' });
    });

    it('compacts history above 70% of the context window and keeps the last 4 turns verbatim', async () => {
        const { hook, summarize, created } = setup([
            textScript('a1', 100),
            textScript('a2', 100),
            textScript('a3', 100),
            textScript('a4', 100),
            textScript('a5', 800),
            textScript('a6', 100),
        ]);
        for (const question of ['q1', 'q2', 'q3', 'q4', 'q5']) {
            await act(async () => {
                await hook.result.current.send(question);
            });
        }
        expect(hook.result.current.contextFraction).toBeCloseTo(0.8);
        await act(async () => {
            await hook.result.current.send('q6');
        });
        expect(summarize).toHaveBeenCalledTimes(1);
        expect(summarize.mock.calls[0][0].prompt).toContain('User: q1');
        expect(hook.result.current.conversation?.compactedSummary).toBe('Summary of older turns.');
        const lastInput = created[5].inputs[0];
        expect(lastInput.history.filter(message => message.role === 'user')).toHaveLength(4);
        expect(created[5].lastDeps?.systemPrompt).toContain('Summary of older turns.');
    });

    it('compacts and retries once on a context overflow error', async () => {
        const overflow: Script = async function* () {
            yield { type: 'finished', status: 'error', error: CONTEXT_OVERFLOW_ERROR };
        };
        const { hook, summarize } = setup([textScript('a1'), textScript('a2'), overflow, textScript('recovered')]);
        for (const question of ['q1', 'q2']) {
            await act(async () => {
                await hook.result.current.send(question);
            });
        }
        await act(async () => {
            await hook.result.current.send('q3');
        });
        expect(summarize).toHaveBeenCalledTimes(1);
        expect(hook.result.current.status).toBe('idle');
        expect(hook.result.current.messages[hook.result.current.messages.length - 1].parts).toEqual([{ type: 'text', text: 'recovered' }]);
    });

    it('shows a provider error without calling the runner', async () => {
        const { hook, created } = setup([textScript('never')], { resolveProvider: () => ({ error: 'no-provider' }) });
        await act(async () => {
            await hook.result.current.send('hello');
        });
        expect(hook.result.current.status).toBe('error');
        expect(hook.result.current.error).toContain('No model is configured');
        expect(created).toHaveLength(0);
    });

    it('never stores session secrets in messages', async () => {
        const { hook, repository } = setup([textScript('ok')]);
        await act(async () => {
            await hook.result.current.send('hello');
        });
        const [conversation] = await repository.listConversations('root@def');
        const stored = JSON.stringify(await repository.listMessages(conversation.id));
        expect(stored).not.toMatch(/rucioAuthToken|token-abc/);
    });

    it('protects the open conversation from retention', async () => {
        const { hook, repository } = setup([textScript('ok')]);
        const spy = jest.spyOn(repository, 'enforceRetention');
        await act(async () => {
            await hook.result.current.send('hello');
        });
        await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(0));
        const id = hook.result.current.conversation?.id;
        expect(id).toBeDefined();
        for (const call of spy.mock.calls.slice(-1)) expect(call[2]).toContain(id);
    });

    it('flags an expired session when the runner finishes with session_expired', async () => {
        const expired: Script = async function* () {
            yield { type: 'finished', status: 'error', error: SESSION_EXPIRED_ERROR };
        };
        const { hook } = setup([expired, textScript('fine')]);
        await act(async () => {
            await hook.result.current.send('hello');
        });
        expect(hook.result.current.status).toBe('error');
        expect(hook.result.current.sessionExpired).toBe(true);
        expect(hook.result.current.error).toContain('Log in again');
        await act(async () => {
            await hook.result.current.send('again');
        });
        expect(hook.result.current.sessionExpired).toBeFalsy();
    });

    it('stops with sessionExpired when summarize throws session_expired, without calling the model', async () => {
        const { hook, summarize, created } = setup([
            textScript('a1', 100),
            textScript('a2', 100),
            textScript('a3', 100),
            textScript('a4', 100),
            textScript('a5', 800),
            textScript('a6', 100),
        ]);
        for (const question of ['q1', 'q2', 'q3', 'q4', 'q5']) {
            await act(async () => {
                await hook.result.current.send(question);
            });
        }
        summarize.mockRejectedValueOnce(new Error('session_expired'));
        const runnersBefore = created.length;
        await act(async () => {
            await hook.result.current.send('q6');
        });
        expect(hook.result.current.status).toBe('error');
        expect(hook.result.current.sessionExpired).toBe(true);
        expect(created).toHaveLength(runnersBefore);
    });

    it('does not call describeCall for invalid-args approvals', async () => {
        const invalid: Script = async function* (input, runner) {
            yield {
                type: 'tool-call',
                toolCallId: 'call-1',
                toolName: 'do_write',
                args: { __rucio_invalid_args: { message: 'bad', received: {} } },
                policy: 'ask',
            };
            yield { type: 'approval-required', toolCallId: 'call-1' };
            await new Promise<void>(resolve => {
                runner.approvals.set('call-1', () => resolve());
                input.signal.addEventListener('abort', () => resolve());
            });
            yield { type: 'finished', status: 'stopped' };
        };
        const { hook } = setup([invalid]);
        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('go');
        });
        await waitFor(() => expect(hook.result.current.pendingApprovals).toHaveLength(1));
        expect(hook.result.current.pendingApprovals[0].summary).toBe('Run do_write (invalid arguments)');
        await act(async () => {
            hook.result.current.stop();
            await sending;
        });
    });
});
