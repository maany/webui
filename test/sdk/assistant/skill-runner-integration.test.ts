import { z } from 'zod';
import { fakeText } from '@tanstack/ai/testing';
import type { ToolPolicy } from '@/lib/core/entity/assistant/tool';
import { createAgentRunner, type AgentRunnerDeps, type RunnerUpdate } from '@/lib/infrastructure/assistant/tanstack-agent-runner';
import { createSkillSource } from '@/lib/infrastructure/assistant/skill-source';
import { createActivateSkillTool } from '@/lib/infrastructure/assistant/tools/activate-skill-tool';
import { createSkillActivationTracker } from '@/lib/infrastructure/assistant/skill-activation';
import { decorateRunnerDepsWithSkills } from '@/lib/infrastructure/assistant/skill-runner-deps';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import { createRuleTool } from '@/lib/infrastructure/assistant/tools/rules';
import { createReadCurrentPageTool } from '@/lib/infrastructure/assistant/tools/page/read-current-page';
import { createPageActionTool } from '@/lib/infrastructure/assistant/tools/page/page-action';
import { collectUpdates, makeTool, makeToolContextFactory, makeUserMessage } from 'test/fixtures/assistant-fixtures';

type FakeStep = Parameters<ReturnType<typeof fakeText>['setResponses']>[0][number];

function setup(
    script: FakeStep[],
    options: {
        loaded?: () => RegisteredTool<any>[] | null;
        policies?: Record<string, ToolPolicy>;
        realActivate?: boolean;
        extraTools?: RegisteredTool<any>[];
        allowedTools?: string[];
    } = {},
) {
    const tracker = createSkillActivationTracker();
    const skillAllowed = options.allowedTools ?? ['list_rses'];
    const executed: string[] = [];
    const fake = fakeText();
    fake.setResponses(script);
    const controller = new AbortController();
    const activate = makeTool('activate_skill', 'read', z.object({}), async (_args, ctx) => {
        const settle = tracker.beginActivation(ctx.conversationId);
        try {
            tracker.activate(ctx.conversationId, { name: 'rse-only', source: 'shipped', allowedTools: skillAllowed });
            return { activated: 'rse-only' };
        } finally {
            settle();
        }
    });
    const skills = createSkillSource(() => ({
        shipped: [{ name: 'rse-only', description: 'RSE help.', body: 'Use list_rses.', source: 'shipped', allowedTools: skillAllowed }],
        operator: [],
        user: [],
        enabled: {},
    }));
    const contextFor = makeToolContextFactory(controller.signal);
    const base: RegisteredTool<any>[] = [
        options.realActivate ? createActivateSkillTool(tracker) : activate,
        makeTool('list_rses', 'read', z.object({}), async () => {
            executed.push('list_rses');
            return { rses: [] };
        }),
        makeTool('list_rules', 'read', z.object({}), async () => {
            executed.push('list_rules');
            return { rules: [] };
        }),
        makeTool('do_write', 'write', z.object({}), async () => {
            executed.push('do_write');
            return { ok: true };
        }),
        ...(options.extraTools ?? []),
    ];
    const policies: Record<string, ToolPolicy> = {
        activate_skill: 'allow',
        list_rses: 'allow',
        list_rules: 'allow',
        do_write: 'ask',
        ...options.policies,
    };
    const runner = createAgentRunner(
        () => {
            const tools = options.loaded?.() ?? base;
            const raw: AgentRunnerDeps = {
                provider: { providerId: 'p1', kind: 'openai-compatible', model: 'fake-model', via: 'direct' },
                tools,
                policyFor: name => policies[name] ?? 'deny',
                systemPrompt: 'You are a test bot.',
                emit: () => undefined,
                makeToolContext: (toolCallId, turnId) => ({ ...contextFor(toolCallId, turnId), skills }),
                maxSteps: 5,
            };
            return decorateRunnerDepsWithSkills(raw, { conversationId: 'conv-1', tracker });
        },
        { createAdapter: () => fake },
    );
    const run = () =>
        runner.run({ conversationId: 'conv-1', turnId: 'turn-1', history: [], userMessage: makeUserMessage('hello'), signal: controller.signal });
    return { runner, run, executed, fake, base, tracker };
}

const offeredNames = (request: { tools?: ReadonlyArray<{ name: string }> }) => (request.tools ?? []).map(t => t.name).sort();
const last = (updates: RunnerUpdate[]) => updates[updates.length - 1];

describe('skill narrowing through the real runner', () => {
    it('(a) offers a tool loaded mid-turn when the filter allows it', async () => {
        const offered: string[][] = [];
        let loaded = false;
        const s = setup(
            [
                ({ request }) => {
                    offered.push(offeredNames(request as never));
                    loaded = true; // find_tools loads a tool while the model call is running
                    return { toolCalls: [{ name: 'list_rses', input: {} }] };
                },
                ({ request }) => {
                    offered.push(offeredNames(request as never));
                    return { text: 'done' };
                },
            ],
            { loaded: () => (loaded ? [...s.base, makeTool('late_tool', 'read', z.object({}), async () => ({}))] : null) },
        );
        const updates = await collectUpdates(s.run());
        expect(last(updates)).toEqual({ type: 'finished', status: 'completed' });
        expect(offered[0]).not.toContain('late_tool');
        expect(offered[1]).toContain('late_tool');
    });

    it('(b) ends with denied_by_policy when a skill excludes a tool whose approval is pending', async () => {
        const s = setup([
            {
                toolCalls: [
                    { name: 'activate_skill', input: {} },
                    { id: 'write-call', name: 'do_write', input: {} },
                ],
            },
            { text: 'done' },
        ]);
        const updates = await collectUpdates(s.run(), update => {
            if (update.type === 'approval-required') setTimeout(() => s.runner.resolveApproval(update.toolCallId, true), 10);
        });
        expect(updates.some(u => u.type === 'approval-required')).toBe(true);
        expect(s.executed).toEqual([]);
        const results = updates.filter(u => u.type === 'tool-result');
        expect(results).toContainEqual(
            expect.objectContaining({
                toolCallId: 'write-call',
                error: expect.objectContaining({ error: 'denied_by_policy', message: expect.stringMatching(/not available while the skill/) }),
            }),
        );
        expect(last(updates)).toEqual({ type: 'finished', status: 'completed' });
    });

    it('(c) offers only the allowed tools plus activate_skill after activation', async () => {
        const offered: string[][] = [];
        const s = setup([
            ({ request }) => {
                offered.push(offeredNames(request as never));
                return { toolCalls: [{ name: 'activate_skill', input: {} }] };
            },
            ({ request }) => {
                offered.push(offeredNames(request as never));
                return { text: 'done' };
            },
        ]);
        const updates = await collectUpdates(s.run());
        expect(last(updates)).toEqual({ type: 'finished', status: 'completed' });
        expect(offered[0]).toEqual(['activate_skill', 'do_write', 'list_rses', 'list_rules']);
        expect(offered[1]).toEqual(['activate_skill', 'list_rses']);
    });

    it('(d) denies an allowed-policy sibling outside the skill when the real activate_skill runs in the same step', async () => {
        const s = setup(
            [
                {
                    toolCalls: [
                        { name: 'activate_skill', input: { name: 'rse-only' } },
                        { id: 'rules-call', name: 'list_rules', input: {} },
                    ],
                },
                { text: 'done' },
            ],
            { realActivate: true },
        );
        const updates = await collectUpdates(s.run());
        expect(s.executed).toEqual([]);
        const results = updates.filter(u => u.type === 'tool-result');
        expect(results).toContainEqual(
            expect.objectContaining({
                toolCallId: 'rules-call',
                error: expect.objectContaining({
                    error: 'denied_by_policy',
                    message: expect.stringMatching(/not available while the skill rse-only is active/),
                }),
            }),
        );
        expect(last(updates)).toEqual({ type: 'finished', status: 'completed' });
    });

    describe('with real registry tools', () => {
        const spied = <I>(tool: RegisteredTool<I>) => {
            const execute = jest.fn(tool.execute);
            return { tool: { ...tool, execute } as RegisteredTool<I>, execute };
        };
        const deniedFor = (updates: RunnerUpdate[], toolCallId: string) =>
            expect(updates.filter(u => u.type === 'tool-result')).toContainEqual(
                expect.objectContaining({
                    toolCallId,
                    error: expect.objectContaining({ error: 'denied_by_policy', message: expect.stringMatching(/not available while the skill/) }),
                }),
            );
        const VALID_RULE = { dids: [{ scope: 'data18', name: 'XYZ' }], copies: 2, rse_expression: 'tier=1' };
        let fetchMock: jest.Mock;
        const realFetch = global.fetch;
        beforeEach(() => {
            fetchMock = jest.fn(async () => new Response('{}', { status: 200 }));
            global.fetch = fetchMock as unknown as typeof fetch;
        });
        afterEach(() => {
            global.fetch = realFetch;
        });

        it('(e) denies a real write tool emitted in the same step as activate_skill, never runs it, and never hangs', async () => {
            const write = spied(createRuleTool);
            const s = setup(
                [
                    {
                        toolCalls: [
                            { name: 'activate_skill', input: { name: 'rse-only' } },
                            { id: 'real-write', name: 'create_rule', input: VALID_RULE },
                        ],
                    },
                    { text: 'done' },
                ],
                { realActivate: true, extraTools: [write.tool], policies: { create_rule: 'allow' } },
            );
            const updates = await collectUpdates(s.run());
            expect(updates.some(u => u.type === 'approval-required')).toBe(false);
            expect(write.execute).not.toHaveBeenCalled();
            expect(fetchMock).not.toHaveBeenCalled();
            deniedFor(updates, 'real-write');
            expect(last(updates)).toEqual({ type: 'finished', status: 'completed' });
        });

        it('(e2) denies a real write tool with an ask policy while its approval is pending, never runs it, and never hangs', async () => {
            const write = spied(createRuleTool);
            const s = setup(
                [
                    {
                        toolCalls: [
                            { name: 'activate_skill', input: { name: 'rse-only' } },
                            { id: 'real-write', name: 'create_rule', input: VALID_RULE },
                        ],
                    },
                    { text: 'done' },
                ],
                { realActivate: true, extraTools: [write.tool], policies: { create_rule: 'ask' } },
            );
            const updates = await collectUpdates(s.run(), update => {
                if (update.type === 'approval-required') setTimeout(() => s.runner.resolveApproval(update.toolCallId, true), 10);
            });
            expect(write.execute).not.toHaveBeenCalled();
            expect(fetchMock).not.toHaveBeenCalled();
            deniedFor(updates, 'real-write');
            expect(last(updates)).toEqual({ type: 'finished', status: 'completed' });
        });

        it('(f) denies the real page tools emitted in the same step as activate_skill and never runs them', async () => {
            const read = spied(createReadCurrentPageTool());
            const action = spied(createPageActionTool());
            const s = setup(
                [
                    {
                        toolCalls: [
                            { name: 'activate_skill', input: { name: 'rse-only' } },
                            { id: 'read-page', name: 'read_current_page', input: {} },
                            { id: 'page-act', name: 'page_action', input: { name: 'rule_create.prefill' } },
                        ],
                    },
                    { text: 'done' },
                ],
                { realActivate: true, extraTools: [read.tool, action.tool], policies: { read_current_page: 'allow', page_action: 'allow' } },
            );
            const updates = await collectUpdates(s.run());
            expect(read.execute).not.toHaveBeenCalled();
            expect(action.execute).not.toHaveBeenCalled();
            deniedFor(updates, 'read-page');
            deniedFor(updates, 'page-act');
            expect(last(updates)).toEqual({ type: 'finished', status: 'completed' });
        });

        it('(g) skills never loosen policy: a skill that lists a deny-policy write tool does not make it run', async () => {
            const write = spied(createRuleTool);
            const s = setup(
                [
                    { toolCalls: [{ name: 'activate_skill', input: { name: 'rse-only' } }] },
                    { toolCalls: [{ id: 'real-write', name: 'create_rule', input: VALID_RULE }] },
                    { text: 'done' },
                ],
                { realActivate: true, extraTools: [write.tool], allowedTools: ['list_rses', 'create_rule'], policies: { create_rule: 'deny' } },
            );
            const updates = await collectUpdates(s.run());
            expect(updates.some(u => u.type === 'approval-required')).toBe(false);
            expect(write.execute).not.toHaveBeenCalled();
            expect(fetchMock).not.toHaveBeenCalled();
            const result = updates.filter(u => u.type === 'tool-result').find(u => (u as { toolCallId: string }).toolCallId === 'real-write');
            expect(result).toBeDefined();
            expect(JSON.stringify(result)).toContain('denied_by_policy');
            expect(last(updates)).toEqual({ type: 'finished', status: 'completed' });
        });

        it('(h) skills never loosen policy: a skill that lists an ask-policy write tool still asks, and denial keeps it unexecuted', async () => {
            const write = spied(createRuleTool);
            const s = setup(
                [
                    { toolCalls: [{ name: 'activate_skill', input: { name: 'rse-only' } }] },
                    { toolCalls: [{ id: 'real-write', name: 'create_rule', input: VALID_RULE }] },
                    { text: 'done' },
                ],
                { realActivate: true, extraTools: [write.tool], allowedTools: ['list_rses', 'create_rule'], policies: { create_rule: 'ask' } },
            );
            const updates = await collectUpdates(s.run(), update => {
                if (update.type === 'approval-required') setTimeout(() => s.runner.resolveApproval(update.toolCallId, false), 10);
            });
            expect(updates.filter(u => u.type === 'approval-required')).toHaveLength(1);
            expect(write.execute).not.toHaveBeenCalled();
            expect(fetchMock).not.toHaveBeenCalled();
            expect(last(updates)).toEqual({ type: 'finished', status: 'completed' });
        });
    });
});
