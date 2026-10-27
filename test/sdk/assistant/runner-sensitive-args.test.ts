import { z } from 'zod';
import { fakeText } from '@tanstack/ai/testing';
import type { AssistantEvent } from '@/lib/core/entity/assistant/events';
import { registerTools, resetToolRegistryForTests } from '@/lib/infrastructure/assistant/tool-registry';
import { createAgentRunner } from '@/lib/infrastructure/assistant/tanstack-agent-runner';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import { collectUpdates, makeTool, makeToolContextFactory, makeUserMessage } from 'test/fixtures/assistant-fixtures';

describe('runner masks sensitive tool arguments (PF5)', () => {
    it('executes with the real value while the update and the event carry [hidden]', async () => {
        const executedWith: unknown[] = [];
        const base = makeTool('add_identity', 'high', z.object({ account: z.string(), password: z.string() }), async args => {
            executedWith.push(args);
            return { ok: true };
        });
        const tool: RegisteredTool<any> = { ...base, spec: { ...base.spec, sensitiveArgs: ['password'] } };
        const plain = makeTool('plain_read', 'read', z.object({ text: z.string() }), async () => ({ ok: true }));
        const events: AssistantEvent[] = [];
        const fake = fakeText();
        fake.setResponses([
            {
                toolCalls: [
                    { name: 'add_identity', input: { account: 'jdoe', password: 's3cret' } },
                    { name: 'plain_read', input: { text: 'x' } },
                ],
            },
            { text: 'done' },
        ]);
        const controller = new AbortController();
        const runner = createAgentRunner(
            () => ({
                provider: { providerId: 'p1', kind: 'openai-compatible', model: 'fake-model', via: 'direct' },
                tools: [tool, plain],
                policyFor: () => 'allow',
                systemPrompt: 'test',
                emit: event => events.push(event),
                makeToolContext: makeToolContextFactory(controller.signal),
                maxSteps: 5,
            }),
            { createAdapter: () => fake },
        );
        const updates = await collectUpdates(
            runner.run({ conversationId: 'conv-1', turnId: 'turn-1', history: [], userMessage: makeUserMessage('hi'), signal: controller.signal }),
        );

        expect(executedWith).toEqual([{ account: 'jdoe', password: 's3cret' }]);
        expect(updates).toContainEqual(
            expect.objectContaining({ type: 'tool-call', toolName: 'add_identity', args: { account: 'jdoe', password: '[hidden]' } }),
        );
        expect(updates).toContainEqual(expect.objectContaining({ type: 'tool-call', toolName: 'plain_read', args: { text: 'x' } }));
        expect(events).toContainEqual(
            expect.objectContaining({ type: 'tool-call-started', toolName: 'add_identity', args: { account: 'jdoe', password: '[hidden]' } }),
        );
        expect(JSON.stringify(updates)).not.toContain('s3cret');
        expect(JSON.stringify(events)).not.toContain('s3cret');
    });

    it('masks through the registry when the tool is not in the run tools (m4)', async () => {
        const base = makeTool('registered_only', 'high', z.object({ password: z.string() }), async () => ({ ok: true }));
        registerTools([{ ...base, spec: { ...base.spec, sensitiveArgs: ['password'] } }]);
        try {
            const fake = fakeText();
            fake.setResponses([{ toolCalls: [{ name: 'registered_only', input: { password: 's3cret' } }] }, { text: 'done' }]);
            const controller = new AbortController();
            const events: AssistantEvent[] = [];
            const runner = createAgentRunner(
                () => ({
                    provider: { providerId: 'p1', kind: 'openai-compatible', model: 'fake-model', via: 'direct' },
                    tools: [],
                    policyFor: () => 'allow',
                    systemPrompt: 'test',
                    emit: event => events.push(event),
                    makeToolContext: makeToolContextFactory(controller.signal),
                    maxSteps: 5,
                }),
                { createAdapter: () => fake },
            );
            const updates = await collectUpdates(
                runner.run({
                    conversationId: 'conv-1',
                    turnId: 'turn-1',
                    history: [],
                    userMessage: makeUserMessage('hi'),
                    signal: controller.signal,
                }),
            );
            expect(updates).toContainEqual(
                expect.objectContaining({ type: 'tool-call', toolName: 'registered_only', args: { password: '[hidden]' } }),
            );
            expect(JSON.stringify(events)).not.toContain('s3cret');
        } finally {
            resetToolRegistryForTests();
        }
    });
});
