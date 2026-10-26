import { z } from 'zod';
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
