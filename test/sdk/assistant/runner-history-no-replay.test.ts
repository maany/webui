import { z } from 'zod';
import { fakeText } from '@tanstack/ai/testing';
import type { ChatMessage, MessagePart } from '@/lib/core/entity/assistant/conversation';
import { createAgentRunner, toModelMessages } from '@/lib/infrastructure/assistant/tanstack-agent-runner';
import { collectUpdates, makeTool, makeToolContextFactory, makeUserMessage } from 'test/fixtures/assistant-fixtures';

function history(part: Partial<Extract<MessagePart, { type: 'tool-call' }>>, withText = true): ChatMessage[] {
    return [
        makeUserMessage('show rules'),
        {
            id: 'a1',
            conversationId: 'conv-1',
            role: 'assistant',
            createdAt: '2026-10-25T10:00:01.000Z',
            parts: [
                {
                    type: 'tool-call',
                    toolCallId: 'call_nav1',
                    toolName: 'navigate',
                    args: { page: 'rules' },
                    policy: 'allow',
                    status: 'done',
                    result: { url: '/rules', navigated: true, actions: [] },
                    ...part,
                } as MessagePart,
                ...(withText ? [{ type: 'text', text: 'Opened rules.' } as MessagePart] : []),
            ],
        },
    ];
}

async function runWith(h: ChatMessage[]) {
    const executed: string[] = [];
    const fake = fakeText();
    fake.setResponses([{ text: 'ok' }]);
    const controller = new AbortController();
    const tools = [
        makeTool('navigate', 'read', z.object({ page: z.string() }), async args => {
            executed.push(`navigate:${args.page}`);
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
    const updates = await collectUpdates(
        runner.run({ conversationId: 'conv-1', turnId: 't2', history: h, userMessage: makeUserMessage('hello'), signal: controller.signal }),
    );
    return { executed, updates };
}

describe('stored navigate calls in history are never executed on the next turn', () => {
    const cases: Array<[string, ChatMessage[]]> = [
        ['done+text', history({})],
        ['done no text', history({}, false)],
        ['error', history({ status: 'error', error: { code: 'aborted', message: 'x' } as any, result: undefined })],
        ['running', history({ status: 'running', result: undefined })],
        ['expired', history({ status: 'expired', result: undefined })],
    ];
    it.each(cases)('%s', async (_name, h) => {
        const { executed, updates } = await runWith(h);
        expect(executed).toEqual([]);
    });
});
