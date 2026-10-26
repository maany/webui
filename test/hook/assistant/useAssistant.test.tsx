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
        await act(async () => {
            await Promise.resolve();
        });
        const spy = jest.spyOn(repository, 'enforceRetention');
        await act(async () => {
            await hook.result.current.send('hello');
        });
        await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(0));
        const id = hook.result.current.conversation?.id;
        expect(id).toBeDefined();
        for (const call of spy.mock.calls) expect(call[2]).toContain(id);
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

describe('useAssistantController races', () => {
    it('does not resurrect a conversation deleted while its turn streams', async () => {
        const { hook, repository } = setup([approvalScript]);
        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('delete rule r1');
        });
        await waitFor(() => expect(hook.result.current.pendingApprovals).toHaveLength(1));
        const id = hook.result.current.conversation!.id;
        await act(async () => {
            await hook.result.current.deleteConversation(id);
            await sending;
        });
        await act(async () => {
            await hook.result.current.refreshConversations?.();
        });
        expect(await repository.getConversation(id)).toBeUndefined();
        expect(await repository.listMessages(id)).toEqual([]);
        expect(hook.result.current.conversations).toEqual([]);
    });

    it('ignores a send whose account switched while the conversation was being saved', async () => {
        const { hook, repository, created } = setup([textScript('never')]);
        let release: () => void = () => undefined;
        const gate = new Promise<void>(resolve => (release = resolve));
        const original = repository.saveConversation.bind(repository);
        jest.spyOn(repository, 'saveConversation').mockImplementationOnce(async conversation => {
            await gate;
            await original(conversation);
        });
        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('question from A');
        });
        act(() => {
            hook.rerender({ accountKey: 'jdoe@def' });
        });
        await act(async () => {
            release();
            await sending;
        });
        expect(hook.result.current.messages).toEqual([]);
        expect(hook.result.current.conversation).toBeUndefined();
        expect(created).toHaveLength(0);
        for (const conversation of await repository.listConversations('root@def')) {
            expect(await repository.listMessages(conversation.id)).toEqual([]);
        }
    });

    it('drops a send when another conversation was opened while it was saving', async () => {
        const { hook, repository, created } = setup([textScript('never')]);
        await repository.saveConversation(makeConversation('y', 'root@def'));
        let release: () => void = () => undefined;
        const gate = new Promise<void>(resolve => (release = resolve));
        const original = repository.saveConversation.bind(repository);
        jest.spyOn(repository, 'saveConversation').mockImplementationOnce(async conversation => {
            await gate;
            await original(conversation);
        });
        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('question for X');
        });
        await act(async () => {
            await hook.result.current.openConversation('y');
        });
        await act(async () => {
            release();
            await sending;
        });
        expect(hook.result.current.conversation?.id).toBe('y');
        expect(hook.result.current.messages).toEqual([]);
        expect(created).toHaveLength(0);
    });

    it('ignores an open that finishes after the account switched', async () => {
        const { hook, repository } = setup([textScript('x')]);
        await repository.saveConversation(makeConversation('a-1', 'root@def'));
        let release: () => void = () => undefined;
        const gate = new Promise<void>(resolve => (release = resolve));
        const original = repository.getConversation.bind(repository);
        jest.spyOn(repository, 'getConversation').mockImplementationOnce(async id => {
            await gate;
            return original(id);
        });
        let opening!: Promise<void>;
        act(() => {
            opening = hook.result.current.openConversation('a-1');
        });
        act(() => {
            hook.rerender({ accountKey: 'jdoe@def' });
        });
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 20));
        });
        await act(async () => {
            release();
            await opening;
        });
        expect(hook.result.current.conversation).toBeUndefined();
        expect(hook.result.current.messages).toEqual([]);
    });

    it('keeps the new conversation view clean when summarize resolves after newConversation', async () => {
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
        let release: () => void = () => undefined;
        summarize.mockImplementationOnce(() => new Promise(resolve => (release = () => resolve({ text: 'late summary' }))));
        const runnersBefore = created.length;
        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('q6');
        });
        await waitFor(() => expect(summarize).toHaveBeenCalledTimes(1));
        act(() => {
            hook.result.current.newConversation();
        });
        await act(async () => {
            release();
            await sending;
        });
        expect(hook.result.current.conversation).toBeUndefined();
        expect(hook.result.current.messages).toEqual([]);
        expect(hook.result.current.status).toBe('idle');
        expect(created).toHaveLength(runnersBefore);
    });

    it('runs exactly one turn for two sends in the same tick', async () => {
        const { hook, created } = setup([textScript('one')]);
        let first!: Promise<void>;
        let second!: Promise<void>;
        act(() => {
            first = hook.result.current.send('first');
            second = hook.result.current.send('second');
        });
        await act(async () => {
            await Promise.all([first, second]);
        });
        expect(created).toHaveLength(1);
        expect(hook.result.current.messages.filter(message => message.role === 'user')).toHaveLength(1);
    });

    it('clears sessionExpired when the next send fails on provider resolution', async () => {
        const expired: Script = async function* () {
            yield { type: 'finished', status: 'error', error: SESSION_EXPIRED_ERROR };
        };
        let provider: ReturnType<AssistantControllerDeps['resolveProvider']> = PROVIDER;
        const { hook } = setup([expired], { resolveProvider: () => provider });
        await act(async () => {
            await hook.result.current.send('hello');
        });
        expect(hook.result.current.sessionExpired).toBe(true);
        provider = { error: 'no-provider' };
        await act(async () => {
            await hook.result.current.send('again');
        });
        expect(hook.result.current.sessionExpired).toBeFalsy();
        expect(hook.result.current.error).toContain('No model is configured');
    });

    it('flags an expired session for a relay 401', async () => {
        const unauthorized: Script = async function* () {
            yield { type: 'finished', status: 'error', error: 'Request failed with 401' };
        };
        const { hook } = setup([unauthorized]);
        await act(async () => {
            await hook.result.current.send('hello');
        });
        expect(hook.result.current.sessionExpired).toBe(true);
    });

    it('emits turn-finished for the overflowed attempt', async () => {
        const overflow: Script = async function* () {
            yield { type: 'finished', status: 'error', error: CONTEXT_OVERFLOW_ERROR };
        };
        const { hook, events } = setup([textScript('a1'), textScript('a2'), overflow, textScript('recovered')]);
        for (const question of ['q1', 'q2', 'q3']) {
            await act(async () => {
                await hook.result.current.send(question);
            });
        }
        const types = events.map(event => event.type);
        expect(types.filter(type => type === 'turn-started')).toHaveLength(4);
        expect(types.filter(type => type === 'turn-finished')).toHaveLength(4);
    });

    it('does not retry an overflow after the turn was stopped', async () => {
        const overflowAfterStop: Script = async function* (input) {
            await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve()));
            yield { type: 'finished', status: 'error', error: CONTEXT_OVERFLOW_ERROR };
        };
        const { hook, created } = setup([textScript('a1'), textScript('a2'), overflowAfterStop, textScript('never')]);
        for (const question of ['q1', 'q2']) {
            await act(async () => {
                await hook.result.current.send(question);
            });
        }
        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('q3');
        });
        await waitFor(() => expect(created).toHaveLength(3));
        await act(async () => {
            hook.result.current.stop();
            await sending;
        });
        expect(created).toHaveLength(3);
    });

    it('clears pending approvals immediately on stop and ignores a later decision', async () => {
        const { hook } = setup([approvalScript]);
        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('delete rule r1');
        });
        await waitFor(() => expect(hook.result.current.pendingApprovals).toHaveLength(1));
        act(() => {
            hook.result.current.stop();
            hook.result.current.resolveApproval('call-1', 'approved', 'once');
        });
        expect(hook.result.current.pendingApprovals).toEqual([]);
        await act(async () => {
            await sending;
        });
        expect(hook.result.current.messages[1].parts).not.toContainEqual(expect.objectContaining({ type: 'approval', decision: 'approved' }));
    });

    it('reads retention settings live when the turn ends', async () => {
        const overrides: Partial<AssistantControllerDeps> = { retention: () => ({ maxAgeDays: 30, maxTotalMB: 50, clearOnLogout: false }) };
        let release: () => void = () => undefined;
        const gated: Script = async function* () {
            yield { type: 'text-delta', text: 'Hi' };
            await new Promise<void>(resolve => (release = resolve));
            yield { type: 'finished', status: 'completed' };
        };
        const { hook, repository } = setup([gated], overrides);
        await act(async () => {
            await Promise.resolve();
        });
        const spy = jest.spyOn(repository, 'enforceRetention');
        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('hi');
        });
        await waitFor(() => expect(hook.result.current.status).toBe('streaming'));
        overrides.retention = () => ({ maxAgeDays: 7, maxTotalMB: 50, clearOnLogout: false });
        act(() => {
            hook.rerender({ accountKey: 'root@def' });
        });
        await act(async () => {
            release();
            await sending;
        });
        await waitFor(() => expect(spy).toHaveBeenCalled());
        expect(spy.mock.calls[spy.mock.calls.length - 1][0].maxAgeDays).toBe(7);
    });

    it('lets the next turn finish its approval while a superseded turn winds down', async () => {
        let finishA: () => void = () => undefined;
        const slowA: Script = async function* () {
            yield { type: 'text-delta', text: 'A partial' };
            await new Promise<void>(resolve => (finishA = resolve));
            yield { type: 'finished', status: 'stopped' };
        };
        const { hook } = setup([slowA, approvalScript]);
        let sendingA!: Promise<void>;
        act(() => {
            sendingA = hook.result.current.send('first');
        });
        await waitFor(() => expect(hook.result.current.messages[1]?.parts[0]).toEqual({ type: 'text', text: 'A partial' }));
        act(() => {
            hook.result.current.newConversation();
        });
        let sendingB!: Promise<void>;
        act(() => {
            sendingB = hook.result.current.send('delete rule r1');
        });
        await waitFor(() => expect(hook.result.current.pendingApprovals).toHaveLength(1));
        await act(async () => {
            finishA();
            await sendingA;
        });
        expect(hook.result.current.status).toBe('awaiting-approval');
        await act(async () => {
            hook.result.current.resolveApproval('call-1', 'approved', 'once');
            await sendingB;
        });
        const result = hook.result.current;
        expect(result.status).toBe('idle');
        expect(result.messages[1].parts).toContainEqual(expect.objectContaining({ type: 'tool-call', toolCallId: 'call-1', status: 'done' }));
        expect(result.messages[1].parts).toContainEqual({ type: 'text', text: 'Done.' });
        expect(result.messages[1].usage).toBeUndefined();
    });

    it('does not retry an overflow when the turn is stopped after the overflow finish', async () => {
        const overflowThenWait: Script = async function* (input) {
            yield { type: 'finished', status: 'error', error: CONTEXT_OVERFLOW_ERROR };
            await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve()));
        };
        const { hook, created, summarize } = setup([textScript('a1'), textScript('a2'), overflowThenWait, textScript('never')]);
        for (const question of ['q1', 'q2']) {
            await act(async () => {
                await hook.result.current.send(question);
            });
        }
        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('q3');
        });
        await waitFor(() => expect(created).toHaveLength(3));
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 10));
            hook.result.current.stop();
            await sending;
        });
        expect(created).toHaveLength(3);
        expect(summarize).not.toHaveBeenCalled();
    });

    it('ends a turn stopped after an overflow finish as stopped with a single Stopped notice', async () => {
        const overflowThenWait: Script = async function* (input) {
            yield { type: 'finished', status: 'error', error: CONTEXT_OVERFLOW_ERROR };
            await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve()));
        };
        const { hook, created, events } = setup([textScript('a1'), textScript('a2'), overflowThenWait, textScript('never')]);
        for (const question of ['q1', 'q2']) {
            await act(async () => {
                await hook.result.current.send(question);
            });
        }
        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('q3');
        });
        await waitFor(() => expect(created).toHaveLength(3));
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 10));
            hook.result.current.stop();
            await sending;
        });
        const assistant = hook.result.current.messages[hook.result.current.messages.length - 1];
        const notices = assistant.parts.filter(part => part.type === 'notice');
        expect(notices).toEqual([{ type: 'notice', level: 'info', text: 'Stopped.' }]);
        expect(hook.result.current.status).toBe('idle');
        expect(hook.result.current.error).toBeUndefined();
        expect(events.filter(event => event.type === 'turn-finished').pop()).toMatchObject({ status: 'stopped' });
    });

    it('retries with a fresh assistant message id and drops the failed message', async () => {
        const failing: Script = async function* () {
            yield { type: 'text-delta', text: 'partial' };
            yield { type: 'finished', status: 'error', error: 'boom' };
        };
        const { hook, repository } = setup([failing, textScript('fixed')]);
        await act(async () => {
            await hook.result.current.send('hello');
        });
        const failedId = hook.result.current.messages[1].id;
        await act(async () => {
            await hook.result.current.retry?.();
        });
        const { messages, conversation } = hook.result.current;
        expect(messages.map(message => message.role)).toEqual(['user', 'assistant']);
        expect(messages[1].id).not.toBe(failedId);
        expect(messages[1].parts).toContainEqual({ type: 'text', text: 'fixed' });
        const stored = await repository.listMessages(conversation!.id);
        expect(stored.map(message => message.id)).toEqual([messages[0].id, messages[1].id]);
    });

    it('streams nothing into a new chat when New chat happens while a retry deletes the failed message', async () => {
        const failing: Script = async function* () {
            yield { type: 'finished', status: 'error', error: 'boom' };
        };
        const { hook, repository, created } = setup([failing, textScript('late')]);
        await act(async () => {
            await hook.result.current.send('hello');
        });
        let release: () => void = () => undefined;
        const gate = new Promise<void>(resolve => (release = resolve));
        jest.spyOn(repository, 'deleteMessage').mockImplementationOnce(async () => {
            await gate;
        });
        let retrying!: Promise<void>;
        act(() => {
            retrying = hook.result.current.retry?.() ?? Promise.resolve();
        });
        act(() => {
            hook.result.current.newConversation();
        });
        await act(async () => {
            release();
            await retrying;
        });
        expect(created).toHaveLength(1);
        expect(hook.result.current.messages).toEqual([]);
        expect(hook.result.current.status).toBe('idle');
    });

    it('refuses to retry while deleteAllConversations is in progress', async () => {
        const failing: Script = async function* () {
            yield { type: 'finished', status: 'error', error: 'boom' };
        };
        const { hook, repository, created } = setup([failing, textScript('late')]);
        await act(async () => {
            await hook.result.current.send('hello');
        });
        let release: () => void = () => undefined;
        const gate = new Promise<void>(resolve => (release = resolve));
        jest.spyOn(repository, 'deleteAll').mockImplementationOnce(async () => {
            await gate;
        });
        let deleting!: Promise<void>;
        act(() => {
            deleting = hook.result.current.deleteAllConversations?.() ?? Promise.resolve();
        });
        await act(async () => {
            await hook.result.current.retry?.();
        });
        expect(created).toHaveLength(1);
        await act(async () => {
            release();
            await deleting;
        });
    });

    it('does not resurrect a message that retry deleted when the superseded turn saves late', async () => {
        const failing: Script = async function* () {
            yield { type: 'text-delta', text: 'partial' };
            yield { type: 'finished', status: 'error', error: 'boom' };
        };
        const { hook, repository } = setup([failing, textScript('fixed')]);
        let release: () => void = () => undefined;
        const gate = new Promise<void>(resolve => (release = resolve));
        const original = repository.saveMessage.bind(repository);
        let failedId = '';
        jest.spyOn(repository, 'saveMessage').mockImplementation(async message => {
            if (message.role === 'assistant' && !failedId) {
                failedId = message.id;
                await gate; // the superseded turn's final write is still in flight
            }
            return original(message);
        });
        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('hello');
        });
        await waitFor(() => expect(failedId).not.toBe(''));
        await act(async () => {
            await hook.result.current.retry?.();
        });
        await act(async () => {
            release();
            await sending;
        });
        const stored = await repository.listMessages(hook.result.current.conversation!.id);
        expect(stored.map(message => message.id)).not.toContain(failedId);
        expect(hook.result.current.messages.map(message => message.id)).not.toContain(failedId);
    });

    it('does not drop a pending open when a send fails before any turn starts', async () => {
        let provider: ReturnType<AssistantControllerDeps['resolveProvider']> = PROVIDER;
        const { hook, repository } = setup([textScript('unused')], { resolveProvider: () => provider });
        await repository.saveConversation(makeConversation('y', 'root@def'));
        let release: () => void = () => undefined;
        const gate = new Promise<void>(resolve => (release = resolve));
        const original = repository.getConversation.bind(repository);
        jest.spyOn(repository, 'getConversation').mockImplementationOnce(async id => {
            await gate;
            return original(id);
        });
        let opening!: Promise<void>;
        act(() => {
            opening = hook.result.current.openConversation('y');
        });
        provider = { error: 'no-provider' };
        await act(async () => {
            await hook.result.current.send('hello');
        });
        await act(async () => {
            release();
            await opening;
        });
        expect(hook.result.current.conversation?.id).toBe('y');
    });

    it('lets a send invalidate a pending open', async () => {
        const { hook, repository } = setup([textScript('hello back')]);
        await repository.saveConversation(makeConversation('y', 'root@def'));
        let release: () => void = () => undefined;
        const gate = new Promise<void>(resolve => (release = resolve));
        const original = repository.getConversation.bind(repository);
        jest.spyOn(repository, 'getConversation').mockImplementationOnce(async id => {
            await gate;
            return original(id);
        });
        let opening!: Promise<void>;
        act(() => {
            opening = hook.result.current.openConversation('y');
        });
        await act(async () => {
            await hook.result.current.send('hello');
        });
        await act(async () => {
            release();
            await opening;
        });
        expect(hook.result.current.conversation?.id).not.toBe('y');
        expect(hook.result.current.messages.map(message => message.role)).toEqual(['user', 'assistant']);
    });

    it('keeps writing a conversation whose delete failed', async () => {
        const { hook, repository } = setup([textScript('one'), textScript('two')]);
        await act(async () => {
            await hook.result.current.send('first');
        });
        const id = hook.result.current.conversation!.id;
        jest.spyOn(repository, 'deleteConversation').mockRejectedValueOnce(new Error('disk full'));
        await act(async () => {
            await hook.result.current.deleteConversation(id).catch(() => undefined);
        });
        await act(async () => {
            await hook.result.current.openConversation(id);
        });
        await act(async () => {
            await hook.result.current.send('second');
        });
        const stored = await repository.listMessages(id);
        expect(stored.filter(message => message.role === 'assistant')).toHaveLength(2);
    });
    it('deleteAllConversations during a streaming turn leaves no conversation behind', async () => {
        const { hook, repository } = setup([approvalScript]);
        await repository.saveConversation(makeConversation('other', 'root@def', '2026-10-01T00:00:00.000Z'));
        await repository.saveConversation(makeConversation('foreign', 'jdoe@def', '2026-10-01T00:00:00.000Z'));
        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('delete rule r1');
        });
        await waitFor(() => expect(hook.result.current.pendingApprovals).toHaveLength(1));
        const id = hook.result.current.conversation!.id;
        await act(async () => {
            await hook.result.current.deleteAllConversations?.();
            await sending;
        });
        await act(async () => {
            await hook.result.current.refreshConversations?.();
        });
        expect(await repository.listConversations('root@def')).toEqual([]);
        expect(await repository.listMessages(id)).toEqual([]);
        expect(await repository.getConversation('foreign')).toBeDefined();
        expect(hook.result.current.conversation).toBeUndefined();
        expect(hook.result.current.messages).toEqual([]);
        expect(hook.result.current.conversations).toEqual([]);
    });

    it('keeps saving a conversation when deleteAllConversations fails', async () => {
        const { hook, repository } = setup([textScript('one'), textScript('two')]);
        await act(async () => {
            await hook.result.current.send('first');
        });
        const id = hook.result.current.conversation!.id;
        jest.spyOn(repository, 'deleteAll').mockRejectedValueOnce(new Error('disk full'));
        await act(async () => {
            await hook.result.current.deleteAllConversations?.().catch(() => undefined);
        });
        await act(async () => {
            await hook.result.current.openConversation(id);
        });
        await act(async () => {
            await hook.result.current.send('second');
        });
        const stored = await repository.listMessages(id);
        expect(stored.filter(message => message.role === 'assistant')).toHaveLength(2);
    });

    it('rejects when deleteAllConversations fails', async () => {
        const { hook, repository } = setup([textScript('one')]);
        jest.spyOn(repository, 'deleteAll').mockRejectedValueOnce(new Error('disk full'));
        await expect(hook.result.current.deleteAllConversations!()).rejects.toThrow('disk full');
    });

    it('refuses to send while deleteAllConversations is in progress', async () => {
        const { hook, repository, created } = setup([textScript('never')]);
        let release: () => void = () => undefined;
        const gate = new Promise<void>(resolve => (release = resolve));
        const original = repository.listConversations.bind(repository);
        jest.spyOn(repository, 'listConversations').mockImplementationOnce(async accountKey => {
            await gate;
            return original(accountKey);
        });
        let deleting!: Promise<void>;
        act(() => {
            deleting = hook.result.current.deleteAllConversations!();
        });
        await act(async () => {
            await hook.result.current.send('too early');
        });
        expect(created).toHaveLength(0);
        await act(async () => {
            release();
            await deleting;
        });
        expect(await repository.listConversations('root@def')).toEqual([]);
        await act(async () => {
            await hook.result.current.send('after');
        });
        expect(created).toHaveLength(1);
    });

    it('deleteAllConversations takes an explicit account key, also after the session is gone', async () => {
        const { hook, repository } = setup([approvalScript]);
        await repository.saveConversation(makeConversation('other', 'root@def', '2026-10-01T00:00:00.000Z'));
        await repository.saveConversation(makeConversation('foreign', 'jdoe@def', '2026-10-01T00:00:00.000Z'));
        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('delete rule r1');
        });
        await waitFor(() => expect(hook.result.current.pendingApprovals).toHaveLength(1));
        const id = hook.result.current.conversation!.id;
        hook.rerender({ accountKey: '' });
        await act(async () => {
            await hook.result.current.deleteAllConversations?.('root@def');
            await sending;
        });
        expect(await repository.listConversations('root@def')).toEqual([]);
        expect(await repository.listMessages(id)).toEqual([]);
        expect(await repository.getConversation('foreign')).toBeDefined();
        expect(hook.result.current.conversation).toBeUndefined();
    });

    it('deleteAllAccountsConversations empties every account and leaves no running turn behind', async () => {
        const { hook, repository } = setup([approvalScript]);
        await repository.saveConversation(makeConversation('other', 'root@def', '2026-10-01T00:00:00.000Z'));
        await repository.saveConversation(makeConversation('foreign', 'jdoe@def', '2026-10-01T00:00:00.000Z'));
        let sending!: Promise<void>;
        act(() => {
            sending = hook.result.current.send('delete rule r1');
        });
        await waitFor(() => expect(hook.result.current.pendingApprovals).toHaveLength(1));
        const id = hook.result.current.conversation!.id;
        await act(async () => {
            await hook.result.current.deleteAllAccountsConversations?.();
            await sending;
        });
        expect(await repository.listAccounts()).toEqual([]);
        expect(await repository.listMessages(id)).toEqual([]);
        expect(hook.result.current.conversation).toBeUndefined();
    });

    it('refuses to send while deleteAllAccountsConversations is in progress and releases after it settles', async () => {
        const { hook, repository, created } = setup([textScript('never'), textScript('after')]);
        let release: () => void = () => undefined;
        const gate = new Promise<void>(resolve => (release = resolve));
        jest.spyOn(repository, 'deleteAllAccounts').mockImplementationOnce(async () => {
            await gate;
        });
        let deleting!: Promise<void>;
        act(() => {
            deleting = hook.result.current.deleteAllAccountsConversations!();
        });
        await act(async () => {
            await hook.result.current.send('too early');
        });
        expect(created).toHaveLength(0);
        await act(async () => {
            release();
            await deleting;
        });
        await act(async () => {
            await hook.result.current.send('after');
        });
        expect(created).toHaveLength(1);
    });

    it('rejects and keeps saving when deleteAllAccountsConversations fails', async () => {
        const { hook, repository } = setup([textScript('one'), textScript('two')]);
        await act(async () => {
            await hook.result.current.send('first');
        });
        const id = hook.result.current.conversation!.id;
        jest.spyOn(repository, 'deleteAllAccounts').mockRejectedValueOnce(new Error('disk full'));
        await act(async () => {
            await expect(hook.result.current.deleteAllAccountsConversations!()).rejects.toThrow('disk full');
        });
        await act(async () => {
            await hook.result.current.openConversation(id);
        });
        await act(async () => {
            await hook.result.current.send('second');
        });
        expect((await repository.listMessages(id)).filter(m => m.role === 'assistant')).toHaveLength(2);
    });
});

describe('decorateRunnerDeps (phase 5)', () => {
    it('passes the runner deps of a turn and the running conversation id through the decorator', async () => {
        const seen: string[] = [];
        const { hook, created } = setup([textScript('ok')], {
            decorateRunnerDeps: (deps, conversationId) => {
                seen.push(conversationId);
                return { ...deps, toolFilter: tools => tools.filter(tool => tool.spec.name !== 'do_write') };
            },
        });
        await act(async () => {
            await hook.result.current.send('hi');
        });
        const conversationId = hook.result.current.conversation?.id;
        expect(conversationId).toEqual(expect.any(String));
        expect(seen.length).toBeGreaterThan(0);
        expect(new Set(seen)).toEqual(new Set([conversationId]));
        const deps = created[0].lastDeps;
        expect(deps?.tools.map(tool => tool.spec.name)).toEqual(['do_write']);
        expect(deps?.toolFilter?.(deps.tools)).toEqual([]);
    });
});
