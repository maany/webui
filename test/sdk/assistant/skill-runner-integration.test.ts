import { z } from 'zod';
import { fakeText } from '@tanstack/ai/testing';
import type { ToolPolicy } from '@/lib/core/entity/assistant/tool';
import { createAgentRunner, type AgentRunnerDeps, type RunnerUpdate } from '@/lib/infrastructure/assistant/tanstack-agent-runner';
import { createSkillActivationTracker } from '@/lib/infrastructure/assistant/skill-activation';
import { decorateRunnerDepsWithSkills } from '@/lib/infrastructure/assistant/skill-runner-deps';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import { collectUpdates, makeTool, makeToolContextFactory, makeUserMessage } from 'test/fixtures/assistant-fixtures';

type FakeStep = Parameters<ReturnType<typeof fakeText>['setResponses']>[0][number];

function setup(script: FakeStep[], options: { loaded?: () => RegisteredTool<any>[] | null; policies?: Record<string, ToolPolicy> } = {}) {
    const tracker = createSkillActivationTracker();
    const executed: string[] = [];
    const fake = fakeText();
    fake.setResponses(script);
    const controller = new AbortController();
    const activate = makeTool('activate_skill', 'read', z.object({}), async (_args, ctx) => {
        const settle = tracker.beginActivation(ctx.conversationId);
        try {
            tracker.activate(ctx.conversationId, { name: 'rse-only', source: 'shipped', allowedTools: ['list_rses'] });
            return { activated: 'rse-only' };
        } finally {
            settle();
        }
    });
    const base: RegisteredTool<any>[] = [
        activate,
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
                makeToolContext: makeToolContextFactory(controller.signal),
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
                    { name: 'do_write', input: {} },
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
        expect(results).toContainEqual(expect.objectContaining({ error: expect.objectContaining({ error: 'denied_by_policy' }) }));
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
});
