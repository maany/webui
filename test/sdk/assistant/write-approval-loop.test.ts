/**
 * The real runner (phase 1b, with phase 2's per-step tool rebuild) with a scripted OpenAI-compatible model and the
 * real create_rule tool. Covers the agent loop cases of spec 15 and master Review Focus 4 (gate half) and 5.
 */
jest.mock('@/lib/infrastructure/hooks/useToast', () => ({ toast: jest.fn() }));

import type { ChatMessage } from '@/lib/core/entity/assistant/conversation';
import type { AssistantEvent } from '@/lib/core/entity/assistant/events';
import type { ResolvedProvider } from '@/lib/core/entity/assistant/provider-config';
import type { ToolPolicyPrefs } from '@/lib/core/entity/assistant/tool';
import { DEFAULT_ASSISTANT_CONFIG } from '@/lib/core/entity/assistant/assistant-config';
import { expireStaleParts } from '@/lib/infrastructure/assistant/message-reducer';
import { createPolicyFor, type PolicyCaps } from '@/lib/infrastructure/assistant/policy-for';
import { createAgentRunner, type AgentRunner, type RunnerUpdate } from '@/lib/infrastructure/assistant/tanstack-agent-runner';
import { registerTools, resetToolRegistryForTests } from '@/lib/infrastructure/assistant/tool-registry';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import { findToolsTool } from '@/lib/infrastructure/assistant/tools/core-tools';
import { RULE_WRITE_TOOLS } from '@/lib/infrastructure/assistant/tools/rules';
import { SAMPLE_WRITE_ARGS, makeToolContext } from 'test/fixtures/assistant-write-fixtures';
import { createScriptedWorld, type OpenAIRequestBody, type ScriptStep, type ScriptedWorld } from './helpers/scripted-model';

jest.setTimeout(20_000);

const found = RULE_WRITE_TOOLS.find(tool => tool.spec.name === 'create_rule');
if (!found) throw new Error('create_rule is not registered in RULE_WRITE_TOOLS');
const CREATE_RULE = found;

const provider: ResolvedProvider = {
    providerId: 'byok-test',
    kind: 'openai-compatible',
    model: 'scripted',
    baseURL: 'http://model.test/v1',
    apiKey: 'sk-test',
    via: 'direct',
};

type ToolResultUpdate = Extract<RunnerUpdate, { type: 'tool-result' }>;
type ApprovalUpdate = Extract<RunnerUpdate, { type: 'approval-required' }>;

/** What AssistantProvider feeds the live policy: operator caps (undefined while loading), the user's prefs, conversation approvals. */
interface GateState {
    config: PolicyCaps | undefined;
    prefs: ToolPolicyPrefs;
    conversationAllow: string[];
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const originalFetch = global.fetch;

let state: GateState;
let world: ScriptedWorld;
let events: AssistantEvent[];
let runAbort: AbortController;
let unexpectedApprovals: string[];

function freshState(overrides: Partial<GateState> = {}): GateState {
    return {
        config: { writePolicyCap: DEFAULT_ASSISTANT_CONFIG.writePolicyCap, highRiskPolicyCap: DEFAULT_ASSISTANT_CONFIG.highRiskPolicyCap },
        prefs: {},
        conversationAllow: [],
        ...overrides,
    };
}

/** First request of a turn calls create_rule; once a tool result is back, the model answers with text. */
function callCreateRuleThenAnswer(body: OpenAIRequestBody, index: number): ScriptStep {
    const last = body.messages[body.messages.length - 1];
    return last?.role === 'tool'
        ? { text: 'Done.' }
        : { toolCall: { id: `call_${index}`, name: 'create_rule', args: SAMPLE_WRITE_ARGS.create_rule } };
}

/** The policyFor AssistantProvider builds (Task 10), reading `state` on every call. */
function livePolicyFor() {
    return createPolicyFor(
        () => state.config,
        () => ({ toolPolicies: state.prefs }),
        () => new Set(state.conversationAllow),
    );
}

function makeRunner(toolSignal?: AbortSignal): AgentRunner {
    const policyFor = livePolicyFor();
    return createAgentRunner(() => ({
        provider,
        tools: [CREATE_RULE],
        policyFor,
        systemPrompt: 'You are a test assistant.',
        emit: event => events.push(event),
        makeToolContext: (toolCallId, turnId) =>
            makeToolContext({ toolCallId, turnId, signal: toolSignal ?? runAbort.signal, emit: event => events.push(event) }),
        maxSteps: 5,
    }));
}

/**
 * Starts with only find_tools offered, like phase 2's active set. find_tools loads create_rule into `active`, and
 * phase 2's refresh middleware offers it on the next model call of the same run.
 */
function makeMidTurnRunner(): AgentRunner {
    const policyFor = livePolicyFor();
    const active = new Set<string>();
    return createAgentRunner(() => ({
        provider,
        tools: [findToolsTool, ...(active.has('create_rule') ? [CREATE_RULE] : [])] as RegisteredTool<any>[],
        policyFor,
        systemPrompt: 'You are a test assistant.',
        emit: event => events.push(event),
        makeToolContext: (toolCallId, turnId) =>
            makeToolContext({
                toolCallId,
                turnId,
                signal: runAbort.signal,
                emit: event => events.push(event),
                activateTools: names => names.forEach(name => active.add(name)),
                isToolVisible: () => true,
            }),
        maxSteps: 5,
    }));
}

/** Request 0 loads tools, request 1 calls the freshly loaded create_rule, request 2 answers. Tool results: [0] find_tools, [1] create_rule. */
function findThenCreateRule(_body: OpenAIRequestBody, index: number): ScriptStep {
    if (index === 0) return { toolCall: { id: 'call_find', name: 'find_tools', args: { query: 'create replication rule' } } };
    if (index === 1) return { toolCall: { id: 'call_write', name: 'create_rule', args: SAMPLE_WRITE_ARGS.create_rule } };
    return { text: 'Done.' };
}

function userMessage(text: string): ChatMessage {
    return {
        id: `u-${Math.random().toString(36).slice(2)}`,
        conversationId: 'conv-1',
        role: 'user',
        parts: [{ type: 'text', text }],
        createdAt: new Date().toISOString(),
    };
}

async function drive(
    runner: AgentRunner,
    text: string,
    onUpdate?: (update: RunnerUpdate) => void | Promise<void>,
    history: ChatMessage[] = [],
): Promise<RunnerUpdate[]> {
    runAbort = new AbortController();
    const updates: RunnerUpdate[] = [];
    const input = {
        conversationId: 'conv-1',
        turnId: `turn-${Math.random().toString(36).slice(2)}`,
        history,
        userMessage: userMessage(text),
        signal: runAbort.signal,
    };
    for await (const update of runner.run(input)) {
        updates.push(update);
        if (onUpdate) await onUpdate(update);
        else if (update.type === 'approval-required') {
            // No handler means the test expects no approval: record it and reject so the failure is fast and explicit.
            unexpectedApprovals.push(update.toolCallId);
            runner.resolveApproval(update.toolCallId, false);
        }
    }
    return updates;
}
const toolResults = (updates: RunnerUpdate[]) => updates.filter((u): u is ToolResultUpdate => u.type === 'tool-result');
const approvals = (updates: RunnerUpdate[]) => updates.filter((u): u is ApprovalUpdate => u.type === 'approval-required');
const finished = (updates: RunnerUpdate[]) => updates.find(u => u.type === 'finished');
const createRuleCalls = () => world.featureCalls.filter(call => call.url === '/api/feature/create-rule');
const toolMessagesSentToModel = (index: number) => world.modelRequests[index]?.messages.filter(m => m.role === 'tool') ?? [];
const offeredTools = (index: number) => (world.modelRequests[index]?.tools ?? []).map(tool => tool.function?.name);

beforeEach(() => {
    resetToolRegistryForTests();
    registerTools([CREATE_RULE, findToolsTool]);
    events = [];
    unexpectedApprovals = [];
    state = freshState();
    world = createScriptedWorld(callCreateRuleThenAnswer);
    global.fetch = world.fetch as unknown as typeof fetch;
});

afterEach(() => {
    expect(world.unexpectedUrls).toEqual([]);
});

afterAll(() => {
    global.fetch = originalFetch;
});

describe('write approval loop', () => {
    it('does not call create-rule before Approve and calls it exactly once after', async () => {
        const runner = makeRunner();
        let callsWhenAsked = -1;
        const updates = await drive(runner, 'Make 2 copies of data18:XYZ on tier=1 for 30 days', async update => {
            if (update.type !== 'approval-required') return;
            callsWhenAsked = createRuleCalls().length;
            await sleep(150);
            expect(createRuleCalls()).toHaveLength(0);
            runner.resolveApproval(update.toolCallId, true);
        });

        expect(callsWhenAsked).toBe(0);
        expect(updates.find(u => u.type === 'tool-call')).toMatchObject({ toolName: 'create_rule', policy: 'ask' });
        expect(createRuleCalls()).toEqual([{ url: '/api/feature/create-rule', method: 'POST', body: SAMPLE_WRITE_ARGS.create_rule }]);
        expect(toolResults(updates)[0].error).toBeUndefined();
        expect(finished(updates)).toMatchObject({ status: 'completed' });
    });

    it('returns rejected_by_user to the model and the UI when the user rejects', async () => {
        const runner = makeRunner();
        const updates = await drive(runner, 'Make a rule', update => {
            if (update.type === 'approval-required') runner.resolveApproval(update.toolCallId, false);
        });

        expect(createRuleCalls()).toHaveLength(0);
        expect(toolResults(updates)[0].error).toMatchObject({ error: 'rejected_by_user' });
        expect(JSON.stringify(toolMessagesSentToModel(1))).toContain('rejected_by_user');
        expect(events).toContainEqual(
            expect.objectContaining({ type: 'tool-call-finished', error: expect.objectContaining({ error: 'rejected_by_user' }) }),
        );
        expect(finished(updates)).toMatchObject({ status: 'completed' });
    });

    it('returns denied_by_policy without asking when the policy denies', async () => {
        state = freshState({ prefs: { create_rule: 'deny' } });
        const updates = await drive(makeRunner(), 'Make a rule');

        expect(approvals(updates)).toHaveLength(0);
        expect(createRuleCalls()).toHaveLength(0);
        expect(toolResults(updates)[0].error).toMatchObject({ error: 'denied_by_policy' });
        expect(JSON.stringify(toolMessagesSentToModel(1))).toContain('denied_by_policy');
        expect(events).toContainEqual(
            expect.objectContaining({ type: 'tool-call-finished', error: expect.objectContaining({ error: 'denied_by_policy' }) }),
        );
    });
});

describe('Review Focus 4: the gate reads the live policy', () => {
    it('applies a lowered operator cap and a lowered user preference on the next turn', async () => {
        const runner = makeRunner();

        state = freshState({ config: { writePolicyCap: 'allow', highRiskPolicyCap: 'ask' }, prefs: { create_rule: 'allow' } });
        const turn1 = await drive(runner, 'Make a rule');
        expect(approvals(turn1)).toHaveLength(0);
        expect(createRuleCalls()).toHaveLength(1);

        state = { ...state, config: { writePolicyCap: 'ask', highRiskPolicyCap: 'ask' } };
        const turn2 = await drive(runner, 'Make another rule', update => {
            if (update.type !== 'approval-required') return;
            expect(createRuleCalls()).toHaveLength(1);
            runner.resolveApproval(update.toolCallId, false);
        });
        expect(approvals(turn2)).toHaveLength(1);
        expect(createRuleCalls()).toHaveLength(1);

        state = { ...state, config: { writePolicyCap: 'allow', highRiskPolicyCap: 'ask' }, prefs: { create_rule: 'deny' } };
        const turn3 = await drive(runner, 'And one more');
        expect(approvals(turn3)).toHaveLength(0);
        expect(toolResults(turn3)[0].error).toMatchObject({ error: 'denied_by_policy' });
        expect(createRuleCalls()).toHaveLength(1);
    });

    it('denies an approved call when the cap drops to deny while the card is pending', async () => {
        const runner = makeRunner();
        const updates = await drive(runner, 'Make a rule', update => {
            if (update.type !== 'approval-required') return;
            state = { ...state, config: { writePolicyCap: 'deny', highRiskPolicyCap: 'deny' } };
            runner.resolveApproval(update.toolCallId, true);
        });

        expect(createRuleCalls()).toHaveLength(0);
        expect(toolResults(updates)[0].error).toMatchObject({ error: 'denied_by_policy' });
    });

    it('denies a call when the user tightens allow to ask during the turn, then asks on the next turn', async () => {
        state = freshState({ config: { writePolicyCap: 'allow', highRiskPolicyCap: 'ask' }, prefs: { create_rule: 'allow' } });
        world = createScriptedWorld((body, index) => {
            if (index === 0) state = { ...state, prefs: { create_rule: 'ask' } }; // changed after tools were built for this run
            return callCreateRuleThenAnswer(body, index);
        });
        global.fetch = world.fetch as unknown as typeof fetch;
        const runner = makeRunner();

        const turn1 = await drive(runner, 'Make a rule');
        expect(approvals(turn1)).toHaveLength(0);
        expect(createRuleCalls()).toHaveLength(0);
        expect(toolResults(turn1)[0].error).toMatchObject({ error: 'denied_by_policy' });

        const turn2 = await drive(runner, 'Try again', update => {
            if (update.type === 'approval-required') runner.resolveApproval(update.toolCallId, false);
        });
        expect(approvals(turn2)).toHaveLength(1);
        expect(createRuleCalls()).toHaveLength(0);
    });

    it('rejects the pending interrupt itself when the policy becomes deny before the model call finishes', async () => {
        // Built as ask (default caps). The flip happens after the tools were built for this model call. The runner's own
        // guard rejects the interrupt; execute and the policy middleware would deny too.
        world = createScriptedWorld((body, index) => {
            if (index === 0) state = { ...state, prefs: { create_rule: 'deny' } };
            return callCreateRuleThenAnswer(body, index);
        });
        global.fetch = world.fetch as unknown as typeof fetch;
        const updates = await drive(makeRunner(), 'Make a rule');

        expect(approvals(updates)).toHaveLength(0);
        expect(unexpectedApprovals).toEqual([]);
        expect(createRuleCalls()).toHaveLength(0);
        expect(toolResults(updates)[0].error).toMatchObject({ error: 'denied_by_policy' });
        expect(finished(updates)).toMatchObject({ status: 'completed' });
    });

    it('denies writes while the operator config is not loaded', async () => {
        state = freshState({ config: undefined, prefs: { create_rule: 'allow' } });
        const updates = await drive(makeRunner(), 'Make a rule');
        expect(approvals(updates)).toHaveLength(0);
        expect(createRuleCalls()).toHaveLength(0);
        expect(toolResults(updates)[0].error).toMatchObject({ error: 'denied_by_policy' });
    });
});

describe('Review Focus 5: a pending write never runs without an explicit Approve', () => {
    it('does not run while the approval waits (the user navigates around)', async () => {
        const runner = makeRunner();
        await drive(runner, 'Make a rule', async update => {
            if (update.type !== 'approval-required') return;
            await sleep(400);
            expect(createRuleCalls()).toHaveLength(0);
            runner.resolveApproval(update.toolCallId, false);
        });
        expect(createRuleCalls()).toHaveLength(0);
    });

    it('does not run after the turn is stopped, even when Approve arrives late', async () => {
        // The tool context gets its own, never aborted signal, so only the runner can prevent the run.
        const toolSignal = new AbortController();
        const runner = makeRunner(toolSignal.signal);
        let pendingId = '';
        let requestsAtStop = -1;
        const updates = await drive(runner, 'Make a rule', update => {
            if (update.type !== 'approval-required') return;
            pendingId = update.toolCallId;
            requestsAtStop = world.modelRequests.length;
            runAbort.abort();
        });

        expect(finished(updates)).toMatchObject({ status: 'stopped' });
        const eventsAtStop = events.length;
        runner.resolveApproval(pendingId, true);
        await sleep(300);
        expect(createRuleCalls()).toHaveLength(0);
        expect(world.modelRequests).toHaveLength(requestsAtStop);
        expect(events.slice(eventsAtStop)).toEqual([]);
        expect(events.some(event => event.type === 'tool-call-finished')).toBe(false);
    });

    it('reports an approval left pending before a reload as rejected_by_user and never runs it', async () => {
        const createdAt = '2026-10-25T11:00:00.000Z';
        const stored: ChatMessage[] = [
            { id: 'm1', conversationId: 'conv-1', role: 'user', parts: [{ type: 'text', text: 'Make a rule' }], createdAt },
            {
                id: 'm2',
                conversationId: 'conv-1',
                role: 'assistant',
                parts: [
                    {
                        type: 'tool-call',
                        toolCallId: 'call_old',
                        toolName: 'create_rule',
                        args: SAMPLE_WRITE_ARGS.create_rule,
                        policy: 'ask',
                        status: 'awaiting-approval',
                    },
                ],
                createdAt,
            },
        ];
        // What phase 1b's openConversation does after a reload
        const history = expireStaleParts(stored, 'jdoe@def', '2026-10-25T12:00:00.000Z');
        expect(history[1].parts).toContainEqual(expect.objectContaining({ type: 'approval', toolCallId: 'call_old', decision: 'expired' }));

        world = createScriptedWorld(() => ({ text: 'Understood, nothing was created.' }));
        global.fetch = world.fetch as unknown as typeof fetch;
        const updates = await drive(makeRunner(), 'What happened to my rule?', undefined, history);

        const sent = world.modelRequests[0].messages;
        expect(sent.some(m => m.role === 'assistant' && m.tool_calls?.some(call => call.id === 'call_old'))).toBe(true);
        const toolMessage = sent.find(m => m.role === 'tool' && m.tool_call_id === 'call_old');
        expect(JSON.stringify(toolMessage?.content)).toContain('rejected_by_user');
        expect(approvals(updates)).toHaveLength(0);
        expect(createRuleCalls()).toHaveLength(0);
    });
});

describe('write tools loaded mid-turn by find_tools', () => {
    it('asks before running a write tool that find_tools loaded in the same turn', async () => {
        world = createScriptedWorld(findThenCreateRule);
        global.fetch = world.fetch as unknown as typeof fetch;
        const runner = makeMidTurnRunner();
        let callsWhenAsked = -1;
        const updates = await drive(runner, 'Make 2 copies of data18:XYZ on tier=1 for 30 days', async update => {
            if (update.type !== 'approval-required') return;
            callsWhenAsked = world.featureCalls.length;
            await sleep(150);
            expect(world.featureCalls).toHaveLength(0); // no /api/feature request of any kind before Approve
            runner.resolveApproval(update.toolCallId, true);
        });

        expect(offeredTools(0)).toEqual(['find_tools']);
        expect(offeredTools(1)).toContain('create_rule');
        expect(callsWhenAsked).toBe(0);
        expect(updates.find(u => u.type === 'tool-call' && u.toolName === 'create_rule')).toMatchObject({ policy: 'ask' });
        expect(approvals(updates)).toHaveLength(1);
        expect(createRuleCalls()).toHaveLength(1);
        expect(finished(updates)).toMatchObject({ status: 'completed' });
    });

    it('returns rejected_by_user for a mid-turn write tool the user rejects', async () => {
        world = createScriptedWorld(findThenCreateRule);
        global.fetch = world.fetch as unknown as typeof fetch;
        const runner = makeMidTurnRunner();
        const updates = await drive(runner, 'Make a rule', update => {
            if (update.type === 'approval-required') runner.resolveApproval(update.toolCallId, false);
        });

        expect(createRuleCalls()).toHaveLength(0);
        expect(toolResults(updates)[1]?.error).toMatchObject({ error: 'rejected_by_user' });
    });
});
