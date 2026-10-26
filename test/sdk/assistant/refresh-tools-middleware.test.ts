import { z } from 'zod';
import type { ToolPolicy } from '@/lib/core/entity/assistant/tool';
import { fakeText } from '@tanstack/ai/testing';
import { createAgentRunner, createRefreshToolsMiddleware } from '@/lib/infrastructure/assistant/tanstack-agent-runner';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import { collectUpdates, makeTool, makeToolContextFactory, makeUserMessage } from 'test/fixtures/assistant-fixtures';

describe('createRefreshToolsMiddleware', () => {
    it('replaces the tool list with a fresh build before every model call', () => {
        let tools = [{ name: 'find_tools' }];
        const middleware = createRefreshToolsMiddleware(() => tools as never);
        expect(middleware.name).toBe('rucio-refresh-tools');
        expect(middleware.onConfig?.({} as never, { tools: [] } as never)).toEqual({ tools: [{ name: 'find_tools' }] });
        tools = [{ name: 'find_tools' }, { name: 'list_rules' }];
        expect(middleware.onConfig?.({} as never, { tools: [] } as never)).toEqual({ tools: [{ name: 'find_tools' }, { name: 'list_rules' }] });
    });
});

describe('tools loaded mid-turn', () => {
    it('offers a tool activated by find_tools on the next model call of the same run', async () => {
        const fake = fakeText();
        let offered: string[] = [];
        fake.setResponses([
            { toolCalls: [{ name: 'find_tools', input: {} }] },
            ({ request }) => {
                offered = (request.tools ?? []).map(tool => tool.name);
                return { text: 'done' };
            },
        ]);
        const active = new Set<string>();
        const findTools = makeTool('find_tools', 'read', z.object({}), async () => {
            active.add('list_rules');
            return { tools: [{ name: 'list_rules' }] };
        });
        const listRules = makeTool('list_rules', 'read', z.object({}), async () => ({ handle: 'rules_1' }));
        const controller = new AbortController();
        const runner = createAgentRunner(
            () => ({
                provider: { providerId: 'p', kind: 'openai-compatible', model: 'fake', via: 'direct' },
                tools: [findTools, ...(active.has('list_rules') ? [listRules] : [])] as RegisteredTool<any>[],
                policyFor: () => 'allow',
                systemPrompt: 's',
                emit: () => undefined,
                makeToolContext: makeToolContextFactory(controller.signal),
                maxSteps: 5,
            }),
            { createAdapter: () => fake },
        );
        const updates = await collectUpdates(
            runner.run({ conversationId: 'c', turnId: 't', history: [], userMessage: makeUserMessage('stuck rules?'), signal: controller.signal }),
        );
        expect(updates).toContainEqual(expect.objectContaining({ type: 'tool-result', result: { tools: [{ name: 'list_rules' }] } }));
        expect(offered).toEqual(['find_tools', 'list_rules']);
    });
});

describe('policy changes and late tools during a run', () => {
    const provider = { providerId: 'p', kind: 'openai-compatible', model: 'fake', via: 'direct' } as const;

    function setupWrite(options: { late?: boolean; onWrite?: (id: string, policies: Record<string, ToolPolicy>) => void } = {}) {
        const executed: string[] = [];
        const policies: Record<string, ToolPolicy> = { find_tools: 'allow', do_write: 'allow' };
        let loaded = !options.late;
        const findTools = makeTool('find_tools', 'read', z.object({}), async () => {
            loaded = true;
            return { tools: [{ name: 'do_write' }] };
        });
        const doWrite = makeTool('do_write', 'write', z.object({ id: z.string() }), async args => {
            executed.push(args.id);
            options.onWrite?.(args.id, policies);
            return { ok: true };
        });
        const controller = new AbortController();
        const fake = fakeText();
        const runner = createAgentRunner(
            () => ({
                provider,
                tools: [findTools, ...(loaded ? [doWrite] : [])] as RegisteredTool<any>[],
                policyFor: name => policies[name] ?? 'deny',
                systemPrompt: 's',
                emit: () => undefined,
                makeToolContext: makeToolContextFactory(controller.signal),
                maxSteps: 6,
            }),
            { createAdapter: () => fake },
        );
        const run = () =>
            runner.run({ conversationId: 'c', turnId: 't', history: [], userMessage: makeUserMessage('go'), signal: controller.signal });
        return { fake, run, runner, executed, policies };
    }

    // Policy changes are made where they are ordered against the runner: the update consumer drains a buffered
    // channel and may only see the first tool-result after the whole turn has run.
    it('asks for approval when a tool built as allow is tightened to ask mid-turn', async () => {
        const { fake, run, runner, executed } = setupWrite({
            // Runs before the next model call rebuilds the tools, so call 2 is built as an ask tool.
            onWrite: (id, policies) => {
                if (id === '1') policies.do_write = 'ask';
            },
        });
        fake.setResponses([
            { toolCalls: [{ name: 'do_write', input: { id: '1' } }] },
            { toolCalls: [{ name: 'do_write', input: { id: '2' } }] },
            { text: 'done' },
        ]);
        const updates = await collectUpdates(run(), update => {
            if (update.type === 'approval-required') setTimeout(() => runner.resolveApproval(update.toolCallId, true), 10);
        });
        expect(updates.filter(update => update.type === 'approval-required')).toHaveLength(1);
        expect(executed).toEqual(['1', '2']);
        expect(updates[updates.length - 1]).toEqual({ type: 'finished', status: 'completed' });
    });

    it('refuses a call built as allow when its policy is tightened to ask after the tools were built', async () => {
        const { fake, run, executed, policies } = setupWrite();
        fake.setResponses([
            { toolCalls: [{ name: 'do_write', input: { id: '1' } }] },
            () => {
                // The tools for this call were already built as allow.
                policies.do_write = 'ask';
                return { toolCalls: [{ name: 'do_write', input: { id: '2' } }] };
            },
            { text: 'done' },
        ]);
        const updates = await collectUpdates(run());
        expect(executed).toEqual(['1']);
        expect(updates.some(update => update.type === 'approval-required')).toBe(false);
        expect(updates.filter(update => update.type === 'tool-result').pop()).toMatchObject({
            error: { error: 'denied_by_policy', message: expect.stringContaining('now needs approval') },
        });
        expect(updates[updates.length - 1]).toEqual({ type: 'finished', status: 'completed' });
    });

    it('refuses a tool built as allow that is denied mid-turn', async () => {
        const { fake, run, executed } = setupWrite({
            onWrite: (id, policies) => {
                if (id === '1') policies.do_write = 'deny';
            },
        });
        fake.setResponses([
            { toolCalls: [{ name: 'do_write', input: { id: '1' } }] },
            { toolCalls: [{ name: 'do_write', input: { id: '2' } }] },
            { text: 'done' },
        ]);
        const updates = await collectUpdates(run());
        expect(executed).toEqual(['1']);
        expect(updates.filter(update => update.type === 'tool-result').pop()).toMatchObject({ error: { error: 'denied_by_policy' } });
    });

    it('resumes the approval of a tool built as ask when its policy becomes allow', async () => {
        const { fake, run, executed, policies } = setupWrite();
        policies.do_write = 'ask';
        fake.setResponses([
            () => {
                // The tools for this call were already built as ask; the interrupt is handled after this.
                policies.do_write = 'allow';
                return { toolCalls: [{ name: 'do_write', input: { id: '1' } }] };
            },
            { text: 'done' },
        ]);
        const updates = await collectUpdates(run());
        expect(executed).toEqual(['1']);
        expect(updates[updates.length - 1]).toEqual({ type: 'finished', status: 'completed' });
    });

    it('approves an ask tool that find_tools loaded mid-turn', async () => {
        const { fake, run, runner, executed, policies } = setupWrite({ late: true });
        policies.do_write = 'ask';
        fake.setResponses([
            { toolCalls: [{ name: 'find_tools', input: {} }] },
            { toolCalls: [{ name: 'do_write', input: { id: '1' } }] },
            { text: 'done' },
        ]);
        const updates = await collectUpdates(run(), update => {
            if (update.type === 'approval-required') setTimeout(() => runner.resolveApproval(update.toolCallId, true), 10);
        });
        expect(updates.some(update => update.type === 'approval-required')).toBe(true);
        expect(executed).toEqual(['1']);
        expect(updates[updates.length - 1]).toEqual({ type: 'finished', status: 'completed' });
    });
});
