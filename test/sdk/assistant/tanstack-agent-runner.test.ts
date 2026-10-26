import { convertSchemaToJsonSchema } from '@tanstack/ai';
import { z } from 'zod';
import { fakeText } from '@tanstack/ai/testing';
import type { ToolPolicy } from '@/lib/core/entity/assistant/tool';
import type { ChatMessage } from '@/lib/core/entity/assistant/conversation';
import type { AssistantEvent } from '@/lib/core/entity/assistant/events';
import {
    completeText,
    createAgentRunner,
    createProviderAdapter,
    resolveAdapterTarget,
    toModelMessages,
    type RunnerUpdate,
} from '@/lib/infrastructure/assistant/tanstack-agent-runner';
import { buildTanstackTools } from '@/lib/infrastructure/assistant/tanstack-tools';
import { describeRunError } from '@/lib/infrastructure/assistant/runner-errors';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import { collectUpdates, makeTool, makeToolContextFactory, makeUserMessage, textOf } from 'test/fixtures/assistant-fixtures';

type FakeStep = Parameters<ReturnType<typeof fakeText>['setResponses']>[0][number];

function setup(
    script: FakeStep[],
    options: { policies?: Record<string, ToolPolicy>; maxSteps?: number; tokensPerSecond?: number; slowToolMs?: number } = {},
) {
    const executed: string[] = [];
    const events: AssistantEvent[] = [];
    const fake = fakeText({ tokensPerSecond: options.tokensPerSecond });
    fake.setResponses(script);
    const controller = new AbortController();
    let markSlowToolStarted: () => void = () => undefined;
    const slowToolStarted = new Promise<void>(resolve => (markSlowToolStarted = resolve));
    const tools: RegisteredTool<any>[] = [
        makeTool('read_echo', 'read', z.object({ text: z.string() }), async args => {
            executed.push(`read_echo:${args.text}`);
            return { echoed: args.text };
        }),
        makeTool(
            'slow_read',
            'read',
            z.object({}),
            (_args, ctx) =>
                new Promise((resolve, reject) => {
                    markSlowToolStarted();
                    const timer = setTimeout(() => resolve({ ok: true }), options.slowToolMs ?? 5_000);
                    ctx.signal.addEventListener('abort', () => {
                        clearTimeout(timer);
                        reject(new Error('aborted'));
                    });
                }),
        ),
        makeTool('do_write', 'write', z.object({ id: z.string() }), async args => {
            executed.push(`do_write:${args.id}`);
            return { ok: true };
        }),
        makeTool('blocked_write', 'write', z.object({}), async () => {
            executed.push('blocked_write');
            return { ok: true };
        }),
    ];
    const policies: Record<string, ToolPolicy> = {
        read_echo: 'allow',
        slow_read: 'allow',
        do_write: 'ask',
        blocked_write: 'deny',
        ...options.policies,
    };
    const runner = createAgentRunner(
        () => ({
            provider: {
                providerId: 'p1',
                kind: 'openai-compatible',
                model: 'fake-model',
                via: 'direct',
                pricing: { inputPerMTok: 1, outputPerMTok: 2 },
            },
            tools,
            policyFor: name => policies[name] ?? 'deny',
            systemPrompt: 'You are a test bot.',
            emit: event => events.push(event),
            makeToolContext: makeToolContextFactory(controller.signal),
            maxSteps: options.maxSteps ?? 5,
        }),
        { createAdapter: () => fake },
    );
    const run = (history: ChatMessage[] = [], signal: AbortSignal = controller.signal) =>
        runner.run({ conversationId: 'conv-1', turnId: 'turn-1', history, userMessage: makeUserMessage('hello'), signal });
    return { runner, run, controller, executed, events, fake, policies, slowToolStarted };
}

const finished = (updates: RunnerUpdate[]) => updates[updates.length - 1];

describe('createAgentRunner', () => {
    it('streams text and reasoning deltas, reports usage and completes', async () => {
        const { run, events } = setup([{ thinking: 'Let me think.', text: 'Hello from Rucio bot' }]);
        const updates = await collectUpdates(run());
        expect(textOf(updates, 'reasoning-delta')).toBe('Let me think.');
        expect(textOf(updates)).toBe('Hello from Rucio bot');
        expect(updates.some(update => update.type === 'usage' && update.usage.inputTokens > 0 && update.usage.outputTokens > 0)).toBe(true);
        expect(finished(updates)).toEqual({ type: 'finished', status: 'completed' });
        const llm = events.find(event => event.type === 'llm-call-finished');
        expect(llm).toMatchObject({ type: 'llm-call-finished', turnId: 'turn-1' });
        expect(llm && llm.type === 'llm-call-finished' ? llm.usage.costUSD : null).toBeGreaterThan(0);
    });

    it('executes an allowed tool and feeds the result back to the model', async () => {
        const { run, executed, fake, events } = setup([{ toolCalls: [{ name: 'read_echo', input: { text: 'x' } }] }, { text: 'done' }]);
        const updates = await collectUpdates(run());
        expect(executed).toEqual(['read_echo:x']);
        expect(updates).toContainEqual({
            type: 'tool-call',
            toolCallId: expect.any(String),
            toolName: 'read_echo',
            args: { text: 'x' },
            policy: 'allow',
        });
        expect(updates).toContainEqual({
            type: 'tool-result',
            toolCallId: expect.any(String),
            result: { echoed: 'x' },
            durationMs: expect.any(Number),
        });
        expect(textOf(updates)).toBe('done');
        expect(fake.state.callCount).toBe(2);
        expect(events.map(event => event.type)).toEqual(expect.arrayContaining(['tool-call-started', 'tool-call-finished']));
        expect(finished(updates)).toEqual({ type: 'finished', status: 'completed' });
    });

    it('returns invalid_args without executing when the model sends bad arguments', async () => {
        const { run, executed } = setup([{ toolCalls: [{ name: 'read_echo', input: { wrong: 1 } }] }, { text: 'sorry' }]);
        const updates = await collectUpdates(run());
        expect(executed).toEqual([]);
        const result = updates.find(update => update.type === 'tool-result');
        expect(result).toMatchObject({ type: 'tool-result', error: { error: 'invalid_args' } });
    });

    it('pauses an ask tool until resolveApproval(true) and then executes it', async () => {
        const { run, runner, executed } = setup([{ toolCalls: [{ name: 'do_write', input: { id: 'r1' } }] }, { text: 'written' }]);
        let executedAtApproval: string[] | null = null;
        const updates = await collectUpdates(run(), update => {
            if (update.type === 'approval-required') {
                executedAtApproval = [...executed];
                setTimeout(() => runner.resolveApproval(update.toolCallId, true), 10);
            }
        });
        expect(executedAtApproval).toEqual([]);
        expect(executed).toEqual(['do_write:r1']);
        const call = updates.find(update => update.type === 'tool-call');
        expect(call).toMatchObject({ toolName: 'do_write', policy: 'ask' });
        expect(updates.findIndex(update => update.type === 'approval-required')).toBeLessThan(
            updates.findIndex(update => update.type === 'tool-result'),
        );
        expect(textOf(updates)).toBe('written');
        expect(finished(updates)).toEqual({ type: 'finished', status: 'completed' });
    });

    it('returns rejected_by_user to the model when the user rejects', async () => {
        const { run, runner, executed } = setup([{ toolCalls: [{ name: 'do_write', input: { id: 'r1' } }] }, { text: 'ok, not changed' }]);
        const updates = await collectUpdates(run(), update => {
            if (update.type === 'approval-required') setTimeout(() => runner.resolveApproval(update.toolCallId, false), 10);
        });
        expect(executed).toEqual([]);
        expect(updates.find(update => update.type === 'tool-result')).toMatchObject({ error: { error: 'rejected_by_user' } });
        expect(finished(updates)).toEqual({ type: 'finished', status: 'completed' });
    });

    it('auto-approves a pending call when the live policy became allow during the turn', async () => {
        const { run, executed, policies } = setup([{ toolCalls: [{ name: 'do_write', input: { id: 'r1' } }] }, { text: 'done' }]);
        const updates = run();
        policies.do_write = 'ask';
        const seen = await collectUpdates(updates, update => {
            if (update.type === 'tool-call') policies.do_write = 'allow';
        });
        expect(executed).toEqual(['do_write:r1']);
        expect(seen.some(update => update.type === 'approval-required')).toBe(false);
    });

    it('returns denied_by_policy for a denied tool and never executes it', async () => {
        const { run, executed } = setup([{ toolCalls: [{ name: 'blocked_write', input: {} }] }, { text: 'denied' }]);
        const updates = await collectUpdates(run());
        expect(executed).toEqual([]);
        expect(updates.find(update => update.type === 'tool-call')).toMatchObject({ policy: 'deny' });
        expect(updates.find(update => update.type === 'tool-result')).toMatchObject({ error: { error: 'denied_by_policy' } });
    });

    it('stops mid-stream when the signal aborts', async () => {
        const { run, controller } = setup([{ text: 'a long answer that streams slowly for quite a while longer than the test waits' }], {
            tokensPerSecond: 20,
        });
        setTimeout(() => controller.abort(), 120);
        const updates = await collectUpdates(run());
        expect(finished(updates)).toEqual({ type: 'finished', status: 'stopped' });
        expect(textOf(updates).length).toBeLessThan(40);
    });

    it('aborts an in-flight tool on stop', async () => {
        const { run, controller, slowToolStarted } = setup([{ toolCalls: [{ name: 'slow_read', input: {} }] }, { text: 'never' }]);
        // Stop only once the tool is really running, so load cannot reorder the abort and the stream.
        void slowToolStarted.then(() => controller.abort());
        const updates = await collectUpdates(run());
        expect(updates.find(update => update.type === 'tool-result')).toMatchObject({ error: { error: 'aborted' } });
        expect(finished(updates)).toEqual({ type: 'finished', status: 'stopped' });
    });

    it('stops while waiting for an approval without executing the tool', async () => {
        const { run, controller, executed } = setup([{ toolCalls: [{ name: 'do_write', input: { id: 'r1' } }] }, { text: 'never' }]);
        const updates = await collectUpdates(run(), update => {
            if (update.type === 'approval-required') setTimeout(() => controller.abort(), 10);
        });
        expect(executed).toEqual([]);
        expect(finished(updates)).toEqual({ type: 'finished', status: 'stopped' });
    });

    it('finishes with step-limit when the model keeps calling tools', async () => {
        const { run, fake } = setup(
            [
                { toolCalls: [{ name: 'read_echo', input: { text: '1' } }] },
                { toolCalls: [{ name: 'read_echo', input: { text: '2' } }] },
                { text: 'never reached' },
            ],
            { maxSteps: 2 },
        );
        const updates = await collectUpdates(run());
        expect(finished(updates)).toEqual({ type: 'finished', status: 'step-limit' });
        expect(fake.state.callCount).toBe(2);
    });

    it('keeps the step limit across approval resumes when the policy flips to allow', async () => {
        const { run, executed, policies, fake } = setup(
            [
                { toolCalls: [{ name: 'do_write', input: { id: '1' } }] },
                { toolCalls: [{ name: 'do_write', input: { id: '2' } }] },
                { toolCalls: [{ name: 'do_write', input: { id: '3' } }] },
                { toolCalls: [{ name: 'do_write', input: { id: '4' } }] },
                { text: 'never reached' },
            ],
            { maxSteps: 2 },
        );
        const updates = await collectUpdates(run(), update => {
            if (update.type === 'tool-call') policies.do_write = 'allow';
        });
        expect(finished(updates)).toEqual({ type: 'finished', status: 'step-limit' });
        expect(fake.state.callCount).toBe(2);
        expect(executed).toEqual(['do_write:1']);
    });

    it('does not let a late-finishing stopped run break the approvals of the next run', async () => {
        const { run, runner, executed, controller } = setup([
            { toolCalls: [{ name: 'slow_read', input: {} }] },
            { toolCalls: [{ name: 'do_write', input: { id: 'b' } }] },
            { text: 'second done' },
        ]);
        const first = collectUpdates(run(), update => {
            if (update.type === 'tool-call') setTimeout(() => controller.abort(), 20);
        });
        await new Promise<void>(resolve => {
            controller.signal.addEventListener('abort', () => resolve());
            setTimeout(resolve, 500);
        });
        const second = collectUpdates(run([], new AbortController().signal), update => {
            if (update.type === 'approval-required') setTimeout(() => runner.resolveApproval(update.toolCallId, true), 10);
        });
        const [firstUpdates, secondUpdates] = await Promise.all([first, second]);
        expect(finished(firstUpdates)).toEqual({ type: 'finished', status: 'stopped' });
        expect(executed).toEqual(['do_write:b']);
        expect(finished(secondUpdates)).toEqual({ type: 'finished', status: 'completed' });
    });

    it('finishes with error when the provider fails', async () => {
        const { run } = setup([{ error: 'upstream exploded' }]);
        const updates = await collectUpdates(run());
        expect(finished(updates)).toEqual({ type: 'finished', status: 'error', error: 'upstream exploded' });
    });
});

describe('toModelMessages', () => {
    it('replays text, tool calls and results, and reports expired approvals as rejected', () => {
        const history: ChatMessage[] = [
            makeUserMessage('earlier question'),
            {
                id: 'a1',
                conversationId: 'conv-1',
                role: 'assistant',
                createdAt: '2026-10-25T10:00:01.000Z',
                parts: [
                    { type: 'reasoning', text: 'hidden' },
                    { type: 'text', text: 'Checking.' },
                    {
                        type: 'tool-call',
                        toolCallId: 'c1',
                        toolName: 'read_echo',
                        args: { text: 'q' },
                        policy: 'allow',
                        status: 'done',
                        result: { echoed: 'q' },
                    },
                    { type: 'text', text: 'It says q.' },
                    { type: 'tool-call', toolCallId: 'c2', toolName: 'do_write', args: { id: 'z' }, policy: 'ask', status: 'expired' },
                ],
            },
        ];
        const messages = toModelMessages(history);
        expect(messages).toEqual([
            { role: 'user', content: 'earlier question' },
            {
                role: 'assistant',
                content: 'Checking.',
                toolCalls: [{ id: 'c1', type: 'function', function: { name: 'read_echo', arguments: '{"text":"q"}' } }],
            },
            { role: 'tool', toolCallId: 'c1', content: '{"echoed":"q"}' },
            {
                role: 'assistant',
                content: 'It says q.',
                toolCalls: [{ id: 'c2', type: 'function', function: { name: 'do_write', arguments: '{"id":"z"}' } }],
            },
            { role: 'tool', toolCallId: 'c2', content: expect.stringContaining('rejected_by_user') },
        ]);
    });
});

describe('resolveAdapterTarget', () => {
    const origin = 'https://webui.example.org';

    it('points the operator relay at the same-origin URL with a placeholder key', () => {
        expect(
            resolveAdapterTarget(
                { providerId: 'operator', kind: 'openai-compatible', model: 'm', baseURL: '/api/assistant/llm', via: 'relay' },
                origin,
            ),
        ).toEqual({
            factory: 'openai-compatible',
            name: 'openai-compatible',
            model: 'm',
            apiKey: 'operator-relay',
            baseURL: 'https://webui.example.org/api/assistant/llm',
        });
    });

    it('adds /v1 to an Ollama base URL once', () => {
        const target = resolveAdapterTarget(
            { providerId: 'o', kind: 'ollama', model: 'llama3', baseURL: 'http://localhost:11434/', via: 'direct' },
            origin,
        );
        expect(target).toMatchObject({ factory: 'openai-compatible', baseURL: 'http://localhost:11434/v1', apiKey: 'ollama' });
        const again = resolveAdapterTarget(
            { providerId: 'o', kind: 'ollama', model: 'llama3', baseURL: 'http://gpu:11434/v1', via: 'direct' },
            origin,
        );
        expect(again).toMatchObject({ baseURL: 'http://gpu:11434/v1' });
    });

    it('uses the direct anthropic and openai adapters with the user key', () => {
        expect(resolveAdapterTarget({ providerId: 'a', kind: 'anthropic', model: 'claude', apiKey: 'sk-ant', via: 'direct' }, origin)).toEqual({
            factory: 'anthropic',
            model: 'claude',
            apiKey: 'sk-ant',
        });
        expect(resolveAdapterTarget({ providerId: 'b', kind: 'openai', model: 'gpt', apiKey: 'sk-oa', via: 'direct' }, origin)).toEqual({
            factory: 'openai',
            model: 'gpt',
            apiKey: 'sk-oa',
        });
    });

    it('requires a base URL for a direct openai-compatible provider', () => {
        expect(() => resolveAdapterTarget({ providerId: 'c', kind: 'openai-compatible', model: 'm', via: 'direct' }, origin)).toThrow('base URL');
    });
});

describe('completeText', () => {
    it('returns the text and usage of a single completion', async () => {
        const fake = fakeText();
        fake.setResponses([{ text: 'A short summary.' }]);
        const result = await completeText(
            {
                provider: { providerId: 'p', kind: 'openai-compatible', model: 'fake', via: 'direct' },
                system: 'Summarise.',
                prompt: 'User: hi',
                threadId: 'summary-1',
            },
            { createAdapter: () => fake },
        );
        expect(result.text).toBe('A short summary.');
        expect(result.usage?.inputTokens).toBeGreaterThan(0);
    });
});

describe('toolFilter', () => {
    it('only offers the tools the filter keeps', async () => {
        const fake = fakeText();
        let offered: string[] = [];
        fake.setResponses([
            ({ request }) => {
                offered = (request.tools ?? []).map(tool => tool.name);
                return { text: 'ok' };
            },
        ]);
        const controller = new AbortController();
        const tools = [makeTool('keep_me', 'read', z.object({}), async () => ({})), makeTool('drop_me', 'read', z.object({}), async () => ({}))];
        const runner = createAgentRunner(
            () => ({
                provider: { providerId: 'p', kind: 'openai-compatible', model: 'fake', via: 'direct' },
                tools,
                policyFor: () => 'allow',
                systemPrompt: 's',
                emit: () => undefined,
                makeToolContext: makeToolContextFactory(controller.signal),
                maxSteps: 3,
                toolFilter: all => all.filter(tool => tool.spec.name === 'keep_me'),
            }),
            { createAdapter: () => fake },
        );
        await collectUpdates(
            runner.run({ conversationId: 'c', turnId: 't', history: [], userMessage: makeUserMessage('hi'), signal: controller.signal }),
        );
        expect(offered).toEqual(['keep_me']);
    });
});

describe('operator relay session handling', () => {
    const relayProvider = {
        providerId: 'operator',
        kind: 'openai-compatible' as const,
        model: 'm',
        baseURL: '/api/assistant/llm',
        via: 'relay' as const,
    };

    async function runThroughRelay(fetchImpl: typeof fetch) {
        const controller = new AbortController();
        const runner = createAgentRunner(
            () => ({
                provider: relayProvider,
                tools: [],
                policyFor: () => 'allow',
                systemPrompt: 's',
                emit: () => undefined,
                makeToolContext: makeToolContextFactory(controller.signal),
                maxSteps: 3,
            }),
            {
                createAdapter: (provider, hooks) =>
                    createProviderAdapter(provider, { fetch: fetchImpl, origin: 'https://webui.example.org', ...hooks }),
            },
        );
        return collectUpdates(
            runner.run({ conversationId: 'c', turnId: 't', history: [], userMessage: makeUserMessage('hi'), signal: controller.signal }),
        );
    }

    it('reports session_expired when the relay answers with a redirect to the login page', async () => {
        const fetchImpl = jest.fn(async (_url: unknown, init?: RequestInit) => {
            expect(init?.redirect).toBe('manual');
            return new Response(null, { status: 307, headers: { location: '/auth/login' } });
        });
        const updates = await runThroughRelay(fetchImpl as unknown as typeof fetch);
        expect(finished(updates)).toEqual({ type: 'finished', status: 'error', error: 'session_expired' });
    });

    it('reports session_expired for an opaque redirect response', async () => {
        const fetchImpl = jest.fn(async () => ({ type: 'opaqueredirect', status: 0, ok: false, headers: new Headers() } as unknown as Response));
        const updates = await runThroughRelay(fetchImpl as unknown as typeof fetch);
        expect(finished(updates)).toEqual({ type: 'finished', status: 'error', error: 'session_expired' });
    });

    it('reports session_expired when the relay answers 200 with an HTML page', async () => {
        const fetchImpl = jest.fn(
            async () => new Response('<html>Log in</html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
        );
        const updates = await runThroughRelay(fetchImpl as unknown as typeof fetch);
        expect(finished(updates)).toEqual({ type: 'finished', status: 'error', error: 'session_expired' });
    });

    it('maps relay 401 and 404 to plain wording', async () => {
        for (const [status, wording] of [
            [401, 'Your session has expired. Log in again.'],
            [404, 'The assistant is not configured on this server.'],
        ] as const) {
            const fetchImpl = jest.fn(
                async () => new Response('{"error":{"message":"nope"}}', { status, headers: { 'content-type': 'application/json' } }),
            );
            const updates = await runThroughRelay(fetchImpl as unknown as typeof fetch);
            const last = finished(updates);
            expect(last).toMatchObject({ type: 'finished', status: 'error' });
            const error = last.type === 'finished' ? last.error ?? '' : '';
            expect(error).toContain(String(status));
            expect(describeRunError(error, { relay: true })).toBe(wording);
        }
        expect(describeRunError('session_expired', { relay: true })).toBe('Your session has expired. Log in again.');
    });
});

describe('end to end with real tools', () => {
    it('converts tool schemas, runs allow, gates ask and blocks deny through chat()', async () => {
        const executed: string[] = [];
        const controller = new AbortController();
        const tools = [
            makeTool('read_it', 'read', z.object({ q: z.string().optional().default('x') }), async () => {
                executed.push('read_it');
                return { ok: 1 };
            }),
            makeTool('write_it', 'write', z.object({ id: z.string().catch('fallback') }), async () => {
                executed.push('write_it');
                return { ok: 2 };
            }),
            makeTool('nope_it', 'write', z.object({}), async () => {
                executed.push('nope_it');
                return {};
            }),
        ];
        const policies: Record<string, 'allow' | 'ask' | 'deny'> = { read_it: 'allow', write_it: 'ask', nope_it: 'deny' };
        const built = buildTanstackTools(tools, {
            policyFor: name => policies[name],
            makeToolContext: id => makeToolContextFactory(controller.signal)(id, 't'),
            onResult: () => undefined,
        });
        for (const tool of built.serverTools) {
            expect(() => convertSchemaToJsonSchema((tool as { inputSchema?: never }).inputSchema)).not.toThrow();
        }
        const fake = fakeText();
        fake.setResponses([
            { toolCalls: [{ name: 'read_it', input: {} }] },
            { toolCalls: [{ name: 'write_it', input: { id: 'a' } }] },
            { toolCalls: [{ name: 'nope_it', input: {} }] },
            { text: 'all done' },
        ]);
        const runner = createAgentRunner(
            () => ({
                provider: { providerId: 'p', kind: 'openai-compatible', model: 'fake', via: 'direct' },
                tools,
                policyFor: name => policies[name],
                systemPrompt: 's',
                emit: () => undefined,
                makeToolContext: makeToolContextFactory(controller.signal),
                maxSteps: 6,
            }),
            { createAdapter: () => fake },
        );
        let executedAtApproval: string[] = [];
        const updates = await collectUpdates(
            runner.run({ conversationId: 'c', turnId: 't', history: [], userMessage: makeUserMessage('go'), signal: controller.signal }),
            update => {
                if (update.type === 'approval-required') {
                    executedAtApproval = [...executed];
                    setTimeout(() => runner.resolveApproval(update.toolCallId, true), 10);
                }
            },
        );
        expect(executedAtApproval).toEqual(['read_it']);
        expect(executed).toEqual(['read_it', 'write_it']);
        expect(updates.filter(update => update.type === 'tool-result' && update.error?.error === 'denied_by_policy')).toHaveLength(1);
        expect(finished(updates)).toEqual({ type: 'finished', status: 'completed' });
    });
});
