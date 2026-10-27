import { z } from 'zod';
import { fakeText } from '@tanstack/ai/testing';
import type { AssistantEvent } from '@/lib/core/entity/assistant/events';
import type { ToolPolicy, ToolRisk } from '@/lib/core/entity/assistant/tool';
import { createAgentRunner, type RunnerUpdate } from '@/lib/infrastructure/assistant/tanstack-agent-runner';
import { applyRunnerUpdate, createAssistantMessage } from '@/lib/infrastructure/assistant/message-reducer';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import { collectUpdates, makeTool, makeToolContextFactory, makeUserMessage } from 'test/fixtures/assistant-fixtures';

/**
 * The ChatClient yields to the host once chunk processing passes its time budget, while chat() keeps running the
 * tools. A clock that jumps on every read makes it yield after every chunk, as it does under load, so a tool starts
 * before the client has delivered its TOOL_CALL_END, and a Stop then drops the chunks still queued.
 */
function forceClientYields() {
    let clock = 0;
    return jest.spyOn(performance, 'now').mockImplementation(() => (clock += 50));
}

type StopAt = 'execute-start' | 'after-delivery' | 'never';

function setup(risk: ToolRisk, stopAt: StopAt) {
    const controller = new AbortController();
    const events: AssistantEvent[] = [];
    const executed: string[] = [];
    const base = makeTool('secret_tool', risk, z.object({ id: z.string(), token: z.string() }), (args, ctx) => {
        executed.push(args.id);
        if (stopAt === 'never') return Promise.resolve({ ok: true });
        // Stop right after the tool started, or once the client had time to deliver the call.
        if (stopAt === 'execute-start') void Promise.resolve().then(() => controller.abort());
        else setTimeout(() => controller.abort(), 20);
        return new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    });
    const tool: RegisteredTool<any> = { ...base, spec: { ...base.spec, sensitiveArgs: ['token'] } };
    const policies: Record<string, ToolPolicy> = { secret_tool: 'allow' };
    // Reading the live policy runs this first, so a test can stop the turn at that exact moment.
    let onPolicyRead: (policy: ToolPolicy) => void = () => undefined;
    const fake = fakeText();
    fake.setResponses([{ toolCalls: [{ name: 'secret_tool', input: { id: '1', token: 's3cret' } }] }, { text: 'done' }]);
    const runner = createAgentRunner(
        () => ({
            provider: { providerId: 'p', kind: 'openai-compatible', model: 'fake', via: 'direct' },
            tools: [tool],
            policyFor: name => {
                const policy = policies[name] ?? 'deny';
                onPolicyRead(policy);
                return policy;
            },
            systemPrompt: 's',
            emit: event => events.push(event),
            makeToolContext: makeToolContextFactory(controller.signal),
            maxSteps: 5,
        }),
        { createAdapter: () => fake },
    );
    const run = () =>
        collectUpdates(
            runner.run({ conversationId: 'conv-1', turnId: 't', history: [], userMessage: makeUserMessage('go'), signal: controller.signal }),
        );
    const watchPolicy = (watch: (policy: ToolPolicy) => void) => {
        onPolicyRead = watch;
    };
    return { run, events, executed, fake, controller, policies, watchPolicy };
}

const finalMessage = (updates: RunnerUpdate[]) => updates.reduce(applyRunnerUpdate, createAssistantMessage('conv-1'));
const toolCalls = (updates: RunnerUpdate[]) => updates.filter(update => update.type === 'tool-call');
const startedEvents = (events: AssistantEvent[]) => events.filter(event => event.type === 'tool-call-started');

describe('a tool call that starts before Stop', () => {
    let clock: jest.SpyInstance | undefined;
    afterEach(() => clock?.mockRestore());

    it('records an allowed write that started before its call reached the client, and warns it may have landed', async () => {
        clock = forceClientYields();
        const { run, events, executed } = setup('write', 'execute-start');
        const updates = await run();
        expect(executed).toEqual(['1']);
        expect(toolCalls(updates)).toEqual([
            { type: 'tool-call', toolCallId: expect.any(String), toolName: 'secret_tool', args: { id: '1', token: '[hidden]' }, policy: 'allow' },
        ]);
        expect(startedEvents(events)).toEqual([expect.objectContaining({ toolName: 'secret_tool', args: { id: '1', token: '[hidden]' } })]);
        expect(updates[updates.length - 1]).toEqual({ type: 'finished', status: 'stopped' });
        const part = finalMessage(updates).parts.find(item => item.type === 'tool-call');
        expect(part).toMatchObject({
            status: 'error',
            error: { error: 'aborted', message: expect.stringContaining('may still have been applied') },
        });
        expect(events).toContainEqual(expect.objectContaining({ type: 'tool-call-finished', error: expect.objectContaining({ error: 'aborted' }) }));
    });

    it('records the call once when the client delivers it after the tool started', async () => {
        clock = forceClientYields();
        const { run, events } = setup('write', 'after-delivery');
        const updates = await run();
        expect(toolCalls(updates)).toHaveLength(1);
        expect(startedEvents(events)).toHaveLength(1);
        expect(finalMessage(updates).parts.find(item => item.type === 'tool-call')).toMatchObject({
            status: 'error',
            error: { error: 'aborted', message: expect.stringContaining('may still have been applied') },
        });
    });

    it('reports a stopped read tool as stopped, without the write warning', async () => {
        clock = forceClientYields();
        const { run } = setup('read', 'execute-start');
        const updates = await run();
        expect(toolCalls(updates)).toHaveLength(1);
        const part = finalMessage(updates).parts.find(item => item.type === 'tool-call');
        expect(part).toMatchObject({ status: 'error', error: { error: 'aborted' } });
        expect(part && part.type === 'tool-call' ? part.error?.message : '').not.toContain('may still have been applied');
    });

    it('keeps the text the model wrote before a tool call ahead of that call', async () => {
        clock = forceClientYields();
        const { run, fake } = setup('write', 'never');
        fake.setResponses([
            { text: 'Let me change that.', toolCalls: [{ name: 'secret_tool', input: { id: '1', token: 's3cret' } }] },
            { text: 'Done.' },
        ]);
        const updates = await run();
        expect(finalMessage(updates).parts.map(part => (part.type === 'text' ? `text:${part.text}` : part.type))).toEqual([
            'text:Let me change that.',
            'tool-call',
            'text:Done.',
        ]);
    });

    it('never warns that a refused call may have landed when Stop lands as it is refused', async () => {
        clock = forceClientYields();
        const { run, fake, controller, policies, executed, watchPolicy } = setup('write', 'never');
        fake.setResponses([
            () => {
                // The tools for this call were built as allow, so the call is refused as now needing approval.
                policies.secret_tool = 'ask';
                watchPolicy(policy => policy === 'ask' && controller.abort());
                return { toolCalls: [{ name: 'secret_tool', input: { id: '1', token: 's3cret' } }] };
            },
            { text: 'never' },
        ]);
        const updates = await run();
        expect(executed).toEqual([]);
        expect(updates[updates.length - 1]).toEqual({ type: 'finished', status: 'stopped' });
        expect(JSON.stringify(updates)).not.toContain('may still have been applied');
        expect(JSON.stringify(finalMessage(updates))).not.toContain('may still have been applied');
    });

    it('closes a call the client never delivered when the turn ends in an error', async () => {
        clock = forceClientYields();
        const { run, fake } = setup('write', 'never');
        fake.setResponses([{ toolCalls: [{ name: 'secret_tool', input: { id: '1', token: 's3cret' } }] }, { error: 'model fell over' }]);
        const updates = await run();
        expect(updates[updates.length - 1]).toMatchObject({ type: 'finished', status: 'error' });
        const part = finalMessage(updates).parts.find(candidate => candidate.type === 'tool-call');
        expect(part && part.type === 'tool-call' ? part.result : undefined).toBeDefined();
        expect(JSON.stringify(updates)).not.toContain('s3cret');
    });

    it('announces a call that finishes normally exactly once', async () => {
        clock = forceClientYields();
        const { run, events } = setup('write', 'never');
        const updates = await run();
        expect(toolCalls(updates)).toHaveLength(1);
        expect(startedEvents(events)).toHaveLength(1);
        expect(updates.filter(update => update.type === 'tool-result')).toHaveLength(1);
        expect(updates[updates.length - 1]).toEqual({ type: 'finished', status: 'completed' });
    });
});
