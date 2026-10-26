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

/** Asks for approval of call-1, then waits until it is resolved or the turn is aborted. */
interface RunnerScript {
    /** After call-1 is resolved, asks for approval of a second call of the same tool. */
    second: boolean;
    /** When it settles before the decision, the runner reports call-1 as done (a crafted state change mid-save). */
    poke: Promise<void> | null;
}

function approvalRunner(toolName: string, log: string[], script: RunnerScript) {
    const resolveSpy = jest.fn<void, [string, boolean]>();
    let decide: ((outcome: boolean | 'aborted') => void) | null = null;
    const runner: AgentRunner = {
        async *run(input): AsyncGenerator<RunnerUpdate> {
            yield { type: 'tool-call', toolCallId: 'call-1', toolName, args: { id: 'r1' }, policy: 'ask' };
            yield { type: 'approval-required', toolCallId: 'call-1' };
            const decided = new Promise<boolean | 'aborted'>(resolve => {
                decide = resolve;
                if (input.signal.aborted) resolve('aborted');
                input.signal.addEventListener('abort', () => resolve('aborted'));
            });
            if (script.poke) {
                const first = await Promise.race([decided, script.poke.then(() => 'poked' as const)]);
                if (first === 'poked') yield { type: 'tool-result', toolCallId: 'call-1', result: { ok: true }, durationMs: 1 };
            }
            const outcome = await decided;
            if (outcome === 'aborted') {
                yield { type: 'finished', status: 'stopped' };
                return;
            }
            yield outcome
                ? { type: 'tool-result', toolCallId: 'call-1', result: { ok: true }, durationMs: 1 }
                : { type: 'tool-result', toolCallId: 'call-1', result: null, error: { error: 'rejected_by_user', message: 'no' }, durationMs: 0 };
            if (script.second) {
                yield { type: 'tool-call', toolCallId: 'call-2', toolName, args: { id: 'r2' }, policy: 'ask' };
                yield { type: 'approval-required', toolCallId: 'call-2' };
                await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve()));
                yield { type: 'finished', status: 'stopped' };
                return;
            }
            yield { type: 'finished', status: 'completed' };
        },
        resolveApproval(toolCallId, approved) {
            log.push(`runner.resolveApproval:${approved}`);
            resolveSpy(toolCallId, approved);
            decide?.(approved);
        },
    };
    return { runner, resolveSpy };
}

function setup(options: { toolName?: string; risk?: 'write' | 'high' } = {}) {
    const toolName = options.toolName ?? 'do_write';
    const log: string[] = [];
    const repository = new InMemoryConversationRepository();
    const originalSaveMessage = repository.saveMessage.bind(repository);
    const originalSaveConversation = repository.saveConversation.bind(repository);
    const saveMessage = jest.spyOn(repository, 'saveMessage').mockImplementation(async message => {
        const decided = message.parts.some(part => part.type === 'approval');
        await originalSaveMessage(message);
        if (decided) log.push('saved-message');
    });
    const saveConversation = jest.spyOn(repository, 'saveConversation').mockImplementation(async conversation => {
        await originalSaveConversation(conversation);
        if (conversation.conversationAllow.length > 0) log.push(`saved-conversation:${conversation.conversationAllow.join(',')}`);
    });
    const script: RunnerScript = { second: false, poke: null };
    const { runner, resolveSpy } = approvalRunner(toolName, log, script);
    const tool = makeTool(toolName, options.risk ?? 'write', z.object({ id: z.string() }), async () => ({ ok: true }));
    registerTools([tool]);
    const bus = createAssistantEventBus();
    const events: AssistantEvent[] = [];
    bus.subscribe(event => events.push(event));
    let liveAllow: () => ReadonlySet<string> = () => new Set();
    const deps = (accountKey: string): AssistantControllerDeps => ({
        accountKey,
        repository: Promise.resolve({ repository, persistent: true }),
        resolveProvider: () => PROVIDER,
        visibleTools: () => [tool],
        makePolicyFor: getAllow => {
            liveAllow = getAllow;
            return name => (getAllow().has(name) ? 'allow' : 'ask');
        },
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
    });
    const hook = renderHook(({ accountKey }: { accountKey: string }) => useAssistantController(deps(accountKey)), {
        initialProps: { accountKey: 'root@def' },
    });
    return {
        hook,
        repository,
        resolveSpy,
        log,
        events,
        allow: () => liveAllow(),
        originalSaveConversation,
        script,
        saveMessage,
        saveConversation,
        originalSaveMessage,
    };
}

async function storedAssistantMessage(repository: InMemoryConversationRepository) {
    const [conversation] = await repository.listConversations('root@def');
    const messages = await repository.listMessages(conversation.id);
    return messages[messages.length - 1];
}

async function startTurn(hook: ReturnType<typeof setup>['hook']) {
    let sending!: Promise<void>;
    act(() => {
        sending = hook.result.current.send('delete rule r1');
    });
    await waitFor(() => expect(hook.result.current.pendingApprovals).toHaveLength(1));
    // Boxed: returning the promise from an async function would wait for the whole turn.
    return { sending };
}

afterEach(() => {
    resetToolRegistryForTests();
    jest.restoreAllMocks();
});

describe('useAssistantController approvals (phase 4 hardening)', () => {
    it('keeps no conversation grant when the decision save fails (I1)', async () => {
        const { hook, repository, resolveSpy, allow, originalSaveMessage } = setup();
        const { sending } = await startTurn(hook);
        let failed = false;
        jest.spyOn(repository, 'saveMessage').mockImplementation(async message => {
            if (!failed && message.parts.some(part => part.type === 'approval')) {
                failed = true;
                throw new Error('quota exceeded');
            }
            await originalSaveMessage(message);
        });
        await act(async () => {
            await hook.result.current.resolveApproval('call-1', 'approved', 'conversation');
            await sending;
        });
        expect(resolveSpy).not.toHaveBeenCalledWith('call-1', true);
        expect(hook.result.current.conversation?.conversationAllow).toEqual([]);
        expect(allow().has('do_write')).toBe(false);
        const [stored] = await repository.listConversations('root@def');
        expect(stored.conversationAllow).toEqual([]);
    });

    it('keeps no conversation grant when only the conversation save fails (I1)', async () => {
        const { hook, repository, resolveSpy, allow, originalSaveConversation } = setup();
        const { sending } = await startTurn(hook);
        let failed = false;
        jest.spyOn(repository, 'saveConversation').mockImplementation(async conversation => {
            if (!failed && conversation.conversationAllow.length > 0) {
                failed = true;
                throw new Error('quota exceeded');
            }
            await originalSaveConversation(conversation);
        });
        await act(async () => {
            await hook.result.current.resolveApproval('call-1', 'approved', 'conversation');
            await sending;
        });
        expect(resolveSpy).not.toHaveBeenCalledWith('call-1', true);
        expect(hook.result.current.conversation?.conversationAllow).toEqual([]);
        expect(allow().has('do_write')).toBe(false);
    });

    it('keeps no grant when Stop lands while the conversation save is in flight (I1b)', async () => {
        const { hook, repository, originalSaveConversation } = setup();
        const { sending } = await startTurn(hook);
        let release: () => void = () => undefined;
        let releaseTurnSave: () => void = () => undefined;
        let held = false;
        let turnHeld = false;
        // The first grant save is the decision's. A second one carrying the grant is the end-of-turn save, held until after the revoke.
        jest.spyOn(repository, 'saveConversation').mockImplementation(async conversation => {
            if (conversation.conversationAllow.length > 0) {
                if (!held) {
                    held = true;
                    await new Promise<void>(resolve => (release = resolve));
                } else if (!turnHeld) {
                    turnHeld = true;
                    await new Promise<void>(resolve => (releaseTurnSave = resolve));
                }
            }
            await originalSaveConversation(conversation);
        });
        let deciding!: Promise<void>;
        act(() => {
            deciding = hook.result.current.resolveApproval('call-1', 'approved', 'conversation') as Promise<void>;
        });
        await waitFor(() => expect(held).toBe(true));
        act(() => {
            hook.result.current.stop();
        });
        // Let the turn wind down and reach its end-of-turn save while the decision save is still held.
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 30));
        });
        await act(async () => {
            release();
            await deciding;
            releaseTurnSave();
            await sending;
        });
        expect(hook.result.current.conversation?.conversationAllow).toEqual([]);
        const [stored] = await repository.listConversations('root@def');
        expect(stored.conversationAllow).toEqual([]);
    });

    it('keeps no grant when the account switches while the conversation save is in flight (I1b)', async () => {
        const { hook, repository, originalSaveConversation } = setup();
        const { sending } = await startTurn(hook);
        let release: () => void = () => undefined;
        let releaseTurnSave: () => void = () => undefined;
        let held = false;
        let turnHeld = false;
        // The first grant save is the decision's. A second one carrying the grant is the end-of-turn save, held until after the revoke.
        jest.spyOn(repository, 'saveConversation').mockImplementation(async conversation => {
            if (conversation.conversationAllow.length > 0) {
                if (!held) {
                    held = true;
                    await new Promise<void>(resolve => (release = resolve));
                } else if (!turnHeld) {
                    turnHeld = true;
                    await new Promise<void>(resolve => (releaseTurnSave = resolve));
                }
            }
            await originalSaveConversation(conversation);
        });
        let deciding!: Promise<void>;
        act(() => {
            deciding = hook.result.current.resolveApproval('call-1', 'approved', 'conversation') as Promise<void>;
        });
        await waitFor(() => expect(held).toBe(true));
        act(() => {
            hook.rerender({ accountKey: 'jdoe@def' });
        });
        // Let the turn wind down and reach its end-of-turn save while the decision save is still held.
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 30));
        });
        await act(async () => {
            release();
            await deciding;
            releaseTurnSave();
            await sending;
        });
        const [stored] = await repository.listConversations('root@def');
        expect(stored.conversationAllow).toEqual([]);
        expect(hook.result.current.conversation?.conversationAllow ?? []).toEqual([]);
    });

    it('rejects the call instead of waiting forever when the stored state changed during the save (m1)', async () => {
        const { hook, repository, resolveSpy, allow, script, originalSaveMessage } = setup();
        let poke: () => void = () => undefined;
        script.poke = new Promise<void>(resolve => (poke = resolve));
        const { sending } = await startTurn(hook);
        let held = false;
        let release: () => void = () => undefined;
        jest.spyOn(repository, 'saveMessage').mockImplementation(async message => {
            if (!held && message.parts.some(part => part.type === 'approval')) {
                held = true;
                await new Promise<void>(resolve => (release = resolve));
            }
            await originalSaveMessage(message);
        });
        let deciding!: Promise<void>;
        act(() => {
            deciding = hook.result.current.resolveApproval('call-1', 'approved', 'conversation') as Promise<void>;
        });
        await waitFor(() => expect(held).toBe(true));
        // The runner reports call-1 as done while the decision is being saved.
        act(() => {
            poke();
        });
        await waitFor(() => expect(hook.result.current.messages[1].parts.find(part => part.type === 'tool-call')).toMatchObject({ status: 'done' }));
        await act(async () => {
            release();
            await deciding;
            await sending;
        });
        expect(resolveSpy).toHaveBeenCalledWith('call-1', false);
        expect(resolveSpy).not.toHaveBeenCalledWith('call-1', true);
        expect(allow().has('do_write')).toBe(false);
    });

    it('still asks for a second call of the same tool after a failed conversation grant (m2)', async () => {
        const { hook, repository, allow, script, originalSaveMessage } = setup();
        script.second = true;
        const { sending } = await startTurn(hook);
        let failed = false;
        jest.spyOn(repository, 'saveMessage').mockImplementation(async message => {
            if (!failed && message.parts.some(part => part.type === 'approval')) {
                failed = true;
                throw new Error('quota exceeded');
            }
            await originalSaveMessage(message);
        });
        await act(async () => {
            await hook.result.current.resolveApproval('call-1', 'approved', 'conversation');
        });
        await waitFor(() => expect(hook.result.current.pendingApprovals.map(item => item.toolCallId)).toEqual(['call-2']));
        expect(allow().has('do_write')).toBe(false);
        await act(async () => {
            hook.result.current.stop();
            await sending;
        });
    });

    it('grants the conversation scope only once the runner resumes (I1)', async () => {
        const { hook, allow, log } = setup();
        const { sending } = await startTurn(hook);
        expect(allow().has('do_write')).toBe(false);
        await act(async () => {
            await hook.result.current.resolveApproval('call-1', 'approved', 'conversation');
            await sending;
        });
        expect(allow().has('do_write')).toBe(true);
        expect(log.indexOf('saved-conversation:do_write')).toBeLessThan(log.indexOf('runner.resolveApproval:true'));
    });

    it('emits an approval event only after the decision is persisted and live (m7)', async () => {
        const { hook, repository, events, originalSaveMessage } = setup();
        const { sending } = await startTurn(hook);
        let release: () => void = () => undefined;
        let held = false;
        jest.spyOn(repository, 'saveMessage').mockImplementation(async message => {
            if (!held && message.parts.some(part => part.type === 'approval')) {
                held = true;
                await new Promise<void>(resolve => (release = resolve));
            }
            await originalSaveMessage(message);
        });
        let deciding!: Promise<void>;
        act(() => {
            deciding = hook.result.current.resolveApproval('call-1', 'approved', 'once') as Promise<void>;
        });
        await waitFor(() => expect(hook.result.current.pendingApprovals).toEqual([]));
        expect(events.some(event => event.type === 'tool-approval')).toBe(false);
        await act(async () => {
            release();
            await deciding;
            await sending;
        });
        expect(events.filter(event => event.type === 'tool-approval')).toEqual([expect.objectContaining({ decision: 'approved' })]);
    });

    it('emits rejected, not approved, when the save failed (m7)', async () => {
        const { hook, repository, events, originalSaveMessage } = setup();
        const { sending } = await startTurn(hook);
        let failed = false;
        jest.spyOn(repository, 'saveMessage').mockImplementation(async message => {
            if (!failed && message.parts.some(part => part.type === 'approval')) {
                failed = true;
                throw new Error('quota exceeded');
            }
            await originalSaveMessage(message);
        });
        await act(async () => {
            await hook.result.current.resolveApproval('call-1', 'approved', 'once');
            await sending;
        });
        expect(events.filter(event => event.type === 'tool-approval')).toEqual([expect.objectContaining({ decision: 'rejected' })]);
    });

    it('ignores an Approve that arrives after Stop and never resumes the runner (Review Focus 5, P2)', async () => {
        const { hook, repository, resolveSpy } = setup();
        const { sending } = await startTurn(hook);
        await act(async () => {
            hook.result.current.stop();
            await hook.result.current.resolveApproval('call-1', 'approved', 'once');
            await sending;
        });
        expect(resolveSpy).not.toHaveBeenCalled();
        const assistant = await storedAssistantMessage(repository);
        expect(assistant.parts.find(part => part.type === 'tool-call')).toMatchObject({ status: 'expired' });
        expect(assistant.parts.filter(part => part.type === 'approval')).toEqual([
            expect.objectContaining({ toolCallId: 'call-1', decision: 'expired' }),
        ]);
    });

    it('expires a waiting approval when the panel unmounts, so it is never stored as runnable (Review Focus 5)', async () => {
        const { hook, repository, resolveSpy } = setup();
        const { sending } = await startTurn(hook);
        await act(async () => {
            hook.unmount();
            await sending;
        });
        expect(resolveSpy).not.toHaveBeenCalled();
        const assistant = await storedAssistantMessage(repository);
        expect(assistant.parts.find(part => part.type === 'tool-call')).toMatchObject({ status: 'expired' });
        expect(assistant.parts).toContainEqual(
            expect.objectContaining({ type: 'approval', toolCallId: 'call-1', decision: 'expired', approver: 'root@def' }),
        );
    });

    it('persists the approval and the running status before the runner resumes', async () => {
        const { hook, repository, log } = setup();
        const { sending } = await startTurn(hook);
        let storedAtResume: unknown;
        const [conversation] = await repository.listConversations('root@def');
        const original = log.push.bind(log);
        log.push = (...items: string[]) => {
            if (items[0] === 'runner.resolveApproval:true') {
                storedAtResume = repository.listMessages(conversation.id);
            }
            return original(...items);
        };
        await act(async () => {
            await hook.result.current.resolveApproval('call-1', 'approved', 'once');
            await sending;
        });
        expect(log.indexOf('saved-message')).toBeGreaterThanOrEqual(0);
        expect(log.indexOf('saved-message')).toBeLessThan(log.indexOf('runner.resolveApproval:true'));
        // The decision was readable from storage at the moment the runner resumed.
        const atResume = (await storedAtResume) as Awaited<ReturnType<typeof repository.listMessages>>;
        const assistantAtResume = atResume[atResume.length - 1];
        expect(assistantAtResume.parts.find(part => part.type === 'tool-call')).toMatchObject({ status: 'running' });
        expect(assistantAtResume.parts).toContainEqual(
            expect.objectContaining({ type: 'approval', toolCallId: 'call-1', decision: 'approved', scope: 'once' }),
        );
    });

    it('stores a rejection as denied before the runner is told', async () => {
        const { hook, repository, log, resolveSpy } = setup();
        const { sending } = await startTurn(hook);
        const [conversation] = await repository.listConversations('root@def');
        let storedAtResume: unknown;
        const original = log.push.bind(log);
        log.push = (...items: string[]) => {
            if (items[0] === 'runner.resolveApproval:false') storedAtResume = repository.listMessages(conversation.id);
            return original(...items);
        };
        await act(async () => {
            await hook.result.current.resolveApproval('call-1', 'rejected', 'once');
            await sending;
        });
        expect(resolveSpy).toHaveBeenCalledWith('call-1', false);
        const atResume = (await storedAtResume) as Awaited<ReturnType<typeof repository.listMessages>>;
        const part = atResume[atResume.length - 1].parts.find(item => item.type === 'tool-call');
        expect(part).toMatchObject({ status: 'denied', error: { error: 'rejected_by_user' } });
    });

    it('resolves once when Approve is clicked twice', async () => {
        const { hook, resolveSpy, saveMessage } = setup();
        const { sending } = await startTurn(hook);
        const savesBefore = saveMessage.mock.calls.length;
        await act(async () => {
            const first = hook.result.current.resolveApproval('call-1', 'approved', 'once');
            const second = hook.result.current.resolveApproval('call-1', 'approved', 'once');
            await Promise.all([first, second]);
            await sending;
        });
        expect(resolveSpy).toHaveBeenCalledTimes(1);
        expect(resolveSpy).toHaveBeenCalledWith('call-1', true);
        // One save for the decision, plus the turn's own tool-result and final saves.
        const decisionSaves = saveMessage.mock.calls.slice(savesBefore).filter(([message]) => message.parts.some(part => part.type === 'approval'));
        expect(decisionSaves.length).toBeGreaterThan(0);
        const approvalParts = (await storedAssistantMessageFromHook(hook)).parts.filter(part => part.type === 'approval');
        expect(approvalParts).toHaveLength(1);
    });

    it('does not resume with true when the decision could not be saved, and tells the user the action did not run', async () => {
        const { hook, repository, resolveSpy, originalSaveMessage } = setup();
        const { sending } = await startTurn(hook);
        let failed = false;
        jest.spyOn(repository, 'saveMessage').mockImplementation(async message => {
            // Only the decision save fails; the turn's own later saves go through.
            if (!failed && message.parts.some(part => part.type === 'approval')) {
                failed = true;
                throw new Error('quota exceeded');
            }
            await originalSaveMessage(message);
        });
        await act(async () => {
            await hook.result.current.resolveApproval('call-1', 'approved', 'once');
            await sending;
        });
        expect(resolveSpy).not.toHaveBeenCalledWith('call-1', true);
        expect(resolveSpy).toHaveBeenCalledWith('call-1', false);
        const part = hook.result.current.messages[1].parts.find(item => item.type === 'tool-call');
        expect(part).toMatchObject({ status: 'denied', error: { message: expect.stringContaining('could not be recorded') } });
        expect(hook.result.current.messages[1].parts).toContainEqual(
            expect.objectContaining({ type: 'approval', toolCallId: 'call-1', decision: 'approved' }),
        );
    });

    it('does nothing for an Approve after the account switched', async () => {
        const { hook, resolveSpy, saveMessage } = setup();
        const { sending } = await startTurn(hook);
        act(() => {
            hook.rerender({ accountKey: 'jdoe@def' });
        });
        await act(async () => {
            await sending;
        });
        const saves = saveMessage.mock.calls.length;
        await act(async () => {
            await hook.result.current.resolveApproval('call-1', 'approved', 'once');
        });
        expect(resolveSpy).not.toHaveBeenCalledWith('call-1', true);
        expect(saveMessage.mock.calls.length).toBe(saves);
    });

    it('does not resume when the turn is stopped while the decision is being saved', async () => {
        const { hook, repository, resolveSpy, originalSaveMessage } = setup();
        const { sending } = await startTurn(hook);
        let finishSave: () => void = () => undefined;
        let held = false;
        jest.spyOn(repository, 'saveMessage').mockImplementation(async message => {
            if (!held && message.parts.some(part => part.type === 'approval' && part.decision === 'approved')) {
                held = true;
                await new Promise<void>(resolve => (finishSave = resolve));
            }
            await originalSaveMessage(message);
        });
        let deciding!: Promise<void>;
        act(() => {
            deciding = hook.result.current.resolveApproval('call-1', 'approved', 'once') as Promise<void>;
        });
        await waitFor(() => expect(hook.result.current.pendingApprovals).toEqual([]));
        await act(async () => {
            hook.result.current.stop();
            finishSave();
            await deciding;
            await sending;
        });
        expect(resolveSpy).not.toHaveBeenCalledWith('call-1', true);
    });

    it('persists conversationAllow before the runner resumes for a write tool', async () => {
        const { hook, repository, log } = setup({ risk: 'write' });
        const { sending } = await startTurn(hook);
        expect(hook.result.current.pendingApprovals[0]).toMatchObject({ risk: 'write', allowConversationScope: true });
        await act(async () => {
            await hook.result.current.resolveApproval('call-1', 'approved', 'conversation');
            await sending;
        });
        expect(log.indexOf('saved-conversation:do_write')).toBeGreaterThanOrEqual(0);
        expect(log.indexOf('saved-conversation:do_write')).toBeLessThan(log.indexOf('runner.resolveApproval:true'));
        const [conversation] = await repository.listConversations('root@def');
        expect(conversation.conversationAllow).toEqual(['do_write']);
    });

    it('never applies conversation scope to a high-risk tool', async () => {
        const { hook, repository, events } = setup({ toolName: 'danger', risk: 'high' });
        const { sending } = await startTurn(hook);
        expect(hook.result.current.pendingApprovals[0]).toMatchObject({ risk: 'high', allowConversationScope: false });
        await act(async () => {
            await hook.result.current.resolveApproval('call-1', 'approved', 'conversation');
            await sending;
        });
        const [conversation] = await repository.listConversations('root@def');
        expect(conversation.conversationAllow).toEqual([]);
        expect(events).toContainEqual(expect.objectContaining({ type: 'tool-approval', decision: 'approved', scope: 'once' }));
    });

    it('treats an unknown tool as high risk, so it never offers conversation scope (PF10)', async () => {
        const { hook } = setup();
        resetToolRegistryForTests();
        const { sending } = await startTurn(hook);
        expect(hook.result.current.pendingApprovals[0]).toMatchObject({ risk: 'high', allowConversationScope: false });
        await act(async () => {
            hook.result.current.stop();
            await sending;
        });
    });
});

async function storedAssistantMessageFromHook(hook: ReturnType<typeof setup>['hook']) {
    const messages = hook.result.current.messages;
    return messages[messages.length - 1];
}
