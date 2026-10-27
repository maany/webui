import { z } from 'zod';
import { fakeText } from '@tanstack/ai/testing';
import type { ToolPolicy } from '@/lib/core/entity/assistant/tool';
import { createAgentRunner, type RunnerUpdate } from '@/lib/infrastructure/assistant/tanstack-agent-runner';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import { collectUpdates, makeTool, makeToolContextFactory, makeUserMessage } from 'test/fixtures/assistant-fixtures';

type FakeStep = Parameters<ReturnType<typeof fakeText>['setResponses']>[0][number];

const REPEATED_MESSAGE = 'This exact call already failed in this turn. Do not retry it; tell the user what went wrong or try a different approach.';

function setup(script: FakeStep[], options: { maxToolCalls?: number; maxSteps?: number; policies?: Record<string, ToolPolicy> } = {}) {
    const executed: string[] = [];
    const fake = fakeText();
    fake.setResponses(script);
    const controller = new AbortController();
    const tools: RegisteredTool<any>[] = [
        makeTool('get_rule', 'read', z.object({ id: z.string() }), async args => {
            executed.push(`get_rule:${args.id}`);
            if (args.id === 'dummy' || /^0+$/.test(args.id)) return { error: 'not_found', message: `Rule ${args.id} was not found` };
            return { id: args.id, state: 'OK' };
        }),
        makeTool('read_echo', 'read', z.object({ text: z.string() }), async args => {
            executed.push(`read_echo:${args.text}`);
            return { echoed: args.text };
        }),
        makeTool('do_write', 'write', z.object({ id: z.string() }), async args => {
            executed.push(`do_write:${args.id}`);
            return { ok: true };
        }),
    ];
    const policies: Record<string, ToolPolicy> = { get_rule: 'allow', read_echo: 'allow', do_write: 'ask', ...options.policies };
    const runner = createAgentRunner(
        () => ({
            provider: { providerId: 'p1', kind: 'openai-compatible', model: 'fake-model', via: 'direct' },
            tools,
            policyFor: name => policies[name] ?? 'deny',
            systemPrompt: 'You are a test bot.',
            emit: () => undefined,
            makeToolContext: makeToolContextFactory(controller.signal),
            maxSteps: options.maxSteps ?? 25,
            ...(options.maxToolCalls !== undefined ? { maxToolCalls: options.maxToolCalls } : {}),
        }),
        { createAdapter: () => fake },
    );
    const run = () =>
        runner.run({ conversationId: 'conv-1', turnId: 'turn-1', history: [], userMessage: makeUserMessage('hello'), signal: controller.signal });
    return { run, runner, executed, fake };
}

const results = (updates: RunnerUpdate[]) =>
    updates.filter((update): update is Extract<RunnerUpdate, { type: 'tool-result' }> => update.type === 'tool-result');
const finished = (updates: RunnerUpdate[]) => updates[updates.length - 1];

describe('runner loop guard: repeated failed calls', () => {
    it('does not run a call identical to one that already failed in this turn', async () => {
        const { run, executed } = setup([
            { toolCalls: [{ name: 'get_rule', input: { id: 'dummy' } }] },
            { toolCalls: [{ name: 'get_rule', input: { id: 'dummy' } }] },
            { text: 'I could not find that rule.' },
        ]);
        const updates = await collectUpdates(run());
        expect(executed).toEqual(['get_rule:dummy']);
        const [first, second] = results(updates);
        expect(first.error).toMatchObject({ error: 'not_found' });
        expect(second.error).toMatchObject({ error: 'repeated_failure', message: REPEATED_MESSAGE });
        expect(finished(updates)).toEqual({ type: 'finished', status: 'completed' });
    });

    it('treats the same arguments in another key order as the same call', async () => {
        const { run, executed } = setup([
            { toolCalls: [{ name: 'get_rule', input: { id: '0000', extra: 1 } }] },
            { toolCalls: [{ name: 'get_rule', input: { extra: 1, id: '0000' } }] },
            { text: 'done' },
        ]);
        const updates = await collectUpdates(run());
        expect(executed).toEqual(['get_rule:0000']);
        expect(results(updates)[1].error).toMatchObject({ error: 'repeated_failure' });
    });

    it('still runs a call with other arguments, and a repeat of a call that succeeded', async () => {
        const { run, executed } = setup([
            { toolCalls: [{ name: 'get_rule', input: { id: 'dummy' } }] },
            { toolCalls: [{ name: 'get_rule', input: { id: 'abc' } }] },
            { toolCalls: [{ name: 'get_rule', input: { id: 'abc' } }] },
            { text: 'done' },
        ]);
        await collectUpdates(run());
        expect(executed).toEqual(['get_rule:dummy', 'get_rule:abc', 'get_rule:abc']);
    });

    it('starts every turn with a clean slate', async () => {
        const { run, executed, fake } = setup([{ toolCalls: [{ name: 'get_rule', input: { id: 'dummy' } }] }, { text: 'not found' }]);
        await collectUpdates(run());
        fake.setResponses([{ toolCalls: [{ name: 'get_rule', input: { id: 'dummy' } }] }, { text: 'still not found' }]);
        await collectUpdates(run());
        expect(executed).toEqual(['get_rule:dummy', 'get_rule:dummy']);
    });
});

describe('runner loop guard: tool call budget', () => {
    it('refuses calls beyond the budget, counting parallel calls, and ends the turn with the step limit', async () => {
        const { run, executed, fake } = setup(
            [
                {
                    toolCalls: [
                        { name: 'read_echo', input: { text: '1' } },
                        { name: 'read_echo', input: { text: '2' } },
                        { name: 'read_echo', input: { text: '3' } },
                    ],
                },
                { toolCalls: [{ name: 'read_echo', input: { text: '4' } }] },
                { toolCalls: [{ name: 'read_echo', input: { text: '5' } }] },
                { text: 'never reached' },
            ],
            { maxToolCalls: 3 },
        );
        const updates = await collectUpdates(run());
        expect(executed).toEqual(['read_echo:1', 'read_echo:2', 'read_echo:3']);
        const refused = results(updates).filter(result => result.error?.error === 'tool_budget_exhausted');
        expect(refused).toHaveLength(2);
        // The model gets one reply after the refusal, then the turn ends with the step limit notice and Continue.
        expect(fake.state.callCount).toBe(3);
        expect(finished(updates)).toEqual({ type: 'finished', status: 'step-limit' });
    });

    it('lets the model answer after the refusal and still offers Continue', async () => {
        const { run, executed, fake } = setup(
            [
                { toolCalls: [{ name: 'read_echo', input: { text: '1' } }] },
                { toolCalls: [{ name: 'read_echo', input: { text: '2' } }] },
                { text: 'Here is what I found so far.' },
            ],
            { maxToolCalls: 1 },
        );
        const updates = await collectUpdates(run());
        expect(executed).toEqual(['read_echo:1']);
        expect(fake.state.callCount).toBe(3);
        expect(finished(updates)).toEqual({ type: 'finished', status: 'step-limit' });
    });

    it('uses a default budget of 20 calls per turn', async () => {
        const many = Array.from({ length: 21 }, (_, i) => ({ name: 'read_echo', input: { text: String(i) } }));
        const { run, executed } = setup([{ toolCalls: many }, { text: 'done' }]);
        const updates = await collectUpdates(run());
        expect(executed).toHaveLength(20);
        expect(results(updates).filter(result => result.error?.error === 'tool_budget_exhausted')).toHaveLength(1);
    });

    it('refuses an approval tool over budget without asking the user', async () => {
        const { run, executed } = setup(
            [
                { toolCalls: [{ name: 'read_echo', input: { text: '1' } }] },
                { toolCalls: [{ name: 'do_write', input: { id: 'r1' } }] },
                { text: 'done' },
            ],
            { maxToolCalls: 1 },
        );
        const updates = await collectUpdates(run());
        expect(updates.some(update => update.type === 'approval-required')).toBe(false);
        expect(executed).toEqual(['read_echo:1']);
        expect(results(updates)[1].error).toMatchObject({ error: 'tool_budget_exhausted' });
    });

    it('keeps the approval flow for calls within the budget', async () => {
        const { run, runner, executed } = setup([{ toolCalls: [{ name: 'do_write', input: { id: 'r1' } }] }, { text: 'written' }], {
            maxToolCalls: 1,
        });
        const updates = await collectUpdates(run(), update => {
            if (update.type === 'approval-required') setTimeout(() => runner.resolveApproval(update.toolCallId, true), 10);
        });
        expect(executed).toEqual(['do_write:r1']);
        expect(finished(updates)).toEqual({ type: 'finished', status: 'completed' });
    });
});

describe('runner loop guard: consecutive failures', () => {
    it('adds a stop and explain note once three calls in a row failed', async () => {
        const { run } = setup([
            { toolCalls: [{ name: 'get_rule', input: { id: 'dummy' } }] },
            { toolCalls: [{ name: 'get_rule', input: { id: '0' } }] },
            { toolCalls: [{ name: 'get_rule', input: { id: '00' } }] },
            { toolCalls: [{ name: 'get_rule', input: { id: '000' } }] },
            { text: 'I could not find it.' },
        ]);
        const updates = await collectUpdates(run());
        const notes = results(updates).map(result => (result.result as { note?: string }).note);
        expect(notes[0]).toBeUndefined();
        expect(notes[1]).toBeUndefined();
        expect(notes[2]).toMatch(/stop calling tools and explain the problem to the user/i);
        expect(notes[3]).toMatch(/stop calling tools and explain the problem to the user/i);
    });

    it('resets the count after a call succeeds', async () => {
        const { run } = setup([
            { toolCalls: [{ name: 'get_rule', input: { id: 'dummy' } }] },
            { toolCalls: [{ name: 'get_rule', input: { id: '0' } }] },
            { toolCalls: [{ name: 'get_rule', input: { id: 'abc' } }] },
            { toolCalls: [{ name: 'get_rule', input: { id: '00' } }] },
            { text: 'done' },
        ]);
        const updates = await collectUpdates(run());
        expect(results(updates).every(result => (result.result as { note?: string }).note === undefined)).toBe(true);
    });
});
