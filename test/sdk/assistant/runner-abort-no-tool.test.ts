import { z } from 'zod';
import { fakeText } from '@tanstack/ai/testing';
import { createAgentRunner } from '@/lib/infrastructure/assistant/tanstack-agent-runner';
import { makeTool, makeToolContextFactory, makeUserMessage } from 'test/fixtures/assistant-fixtures';

describe('an abort before TOOL_CALL_END never executes the tool', () => {
    it.each([1, 5, 20, 60])('abort after %d ms', async ms => {
        const executed: string[] = [];
        const fake = fakeText({ tokensPerSecond: 50 });
        fake.setResponses([
            { text: 'Opening the rules page now for you.', toolCalls: [{ name: 'navigate', input: { page: 'rules' } }] },
            { text: 'done' },
        ]);
        const controller = new AbortController();
        const tools = [
            makeTool('navigate', 'read', z.object({ page: z.string() }), async args => {
                executed.push(`navigate:${args.page}:aborted=${controller.signal.aborted}`);
                return { navigated: true };
            }),
        ];
        const runner = createAgentRunner(
            () =>
                ({
                    provider: {
                        providerId: 'p1',
                        kind: 'openai-compatible',
                        model: 'fake-model',
                        via: 'direct',
                        pricing: { inputPerMTok: 1, outputPerMTok: 2 },
                    },
                    tools,
                    policyFor: () => 'allow',
                    systemPrompt: 's',
                    emit: () => undefined,
                    makeToolContext: makeToolContextFactory(controller.signal),
                    maxSteps: 5,
                } as any),
            { createAdapter: () => fake },
        );
        const seen: string[] = [];
        const it = runner.run({ conversationId: 'conv-1', turnId: 't', history: [], userMessage: makeUserMessage('go'), signal: controller.signal });
        setTimeout(() => controller.abort(), ms);
        for await (const u of it) seen.push(u.type === 'finished' ? `finished:${u.status}` : u.type);
        await new Promise(r => setTimeout(r, 300));
        expect(executed).toEqual([]);
        expect(seen).toContain('finished:stopped');
    });
});
