import { z } from 'zod';
import type { ToolPolicy } from '@/lib/core/entity/assistant/tool';
import { buildTanstackTools, createPolicyMiddleware } from '@/lib/infrastructure/assistant/tanstack-tools';
import { makeTool, makeToolContextFactory } from 'test/fixtures/assistant-fixtures';

type ExecutableTool = { name: string; needsApproval?: boolean; execute: (args: unknown, context?: { toolCallId?: string }) => Promise<unknown> };

function build(policies: Record<string, ToolPolicy>, execute = jest.fn(async () => ({ ok: true }))) {
    const results: Array<[string, unknown]> = [];
    const tools = ['read_a', 'write_b', 'denied_c'].map(name =>
        makeTool(name, name === 'read_a' ? 'read' : 'write', z.object({ id: z.string().optional() }), execute),
    );
    const controller = new AbortController();
    const makeContext = makeToolContextFactory(controller.signal);
    const built = buildTanstackTools(tools, {
        policyFor: name => policies[name],
        makeToolContext: toolCallId => makeContext(toolCallId, 'turn-1'),
        onResult: (toolCallId, result) => results.push([toolCallId, result]),
    });
    const byName = (name: string) => built.serverTools.find(tool => tool.name === name) as unknown as ExecutableTool;
    return { built, byName, results, execute, controller };
}

describe('buildTanstackTools', () => {
    it('marks ask tools with needsApproval and offers a typed client tool only for them', () => {
        const { built, byName } = build({ read_a: 'allow', write_b: 'ask', denied_c: 'deny' });
        expect(byName('read_a').needsApproval).toBeFalsy();
        expect(byName('write_b').needsApproval).toBe(true);
        expect(built.approvalClientTools.map(tool => tool.name)).toEqual(['write_b']);
        expect(Object.fromEntries(built.builtPolicy)).toEqual({ read_a: 'allow', write_b: 'ask', denied_c: 'deny' });
    });

    it('runs the registered tool and reports the duration', async () => {
        const { byName, results, execute } = build({ read_a: 'allow', write_b: 'ask', denied_c: 'deny' });
        await expect(byName('read_a').execute({ id: 'x' }, { toolCallId: 'call-1' })).resolves.toEqual({ ok: true });
        expect(execute).toHaveBeenCalledWith({ id: 'x' }, expect.objectContaining({ toolCallId: 'call-1', accountKey: 'root@def' }));
        expect(results).toEqual([['call-1', { ok: true }]]);
    });

    it('re-reads the policy at call time and refuses a tool that became deny', async () => {
        const policies: Record<string, ToolPolicy> = { read_a: 'allow', write_b: 'ask', denied_c: 'deny' };
        const { byName, execute } = build(policies);
        policies.read_a = 'deny';
        await expect(byName('read_a').execute({}, { toolCallId: 'call-2' })).resolves.toMatchObject({ error: 'denied_by_policy' });
        expect(execute).not.toHaveBeenCalled();
    });

    it('turns a thrown error into unavailable, or aborted when the turn was stopped', async () => {
        const failing = jest.fn(async () => {
            throw new Error('boom');
        });
        const { byName, controller } = build({ read_a: 'allow', write_b: 'ask', denied_c: 'deny' }, failing);
        await expect(byName('read_a').execute({}, { toolCallId: 'call-3' })).resolves.toEqual({ error: 'unavailable', message: 'boom' });
        controller.abort();
        await expect(byName('read_a').execute({}, { toolCallId: 'call-4' })).resolves.toMatchObject({ error: 'aborted' });
    });
});

describe('createPolicyMiddleware', () => {
    const hook = (toolName: string) => ({ toolName, toolCallId: 'call-9', toolCall: {} as never, tool: undefined, args: {} });

    it('skips denied tools with denied_by_policy and lets others through', () => {
        const onResult = jest.fn();
        const middleware = createPolicyMiddleware(name => (name === 'denied_c' ? 'deny' : 'allow'), onResult);
        expect(middleware.onGuardToolCall?.({} as never, hook('read_a'))).toBeUndefined();
        expect(middleware.onGuardToolCall?.({} as never, hook('denied_c'))).toEqual({
            type: 'skip',
            result: expect.objectContaining({ error: 'denied_by_policy' }),
        });
        expect(onResult).toHaveBeenCalledWith('call-9', expect.anything(), expect.objectContaining({ error: 'denied_by_policy' }), 0);
    });

    it('maps TanStack validation failures to invalid_args', () => {
        const middleware = createPolicyMiddleware(() => 'allow', jest.fn());
        const decision = middleware.onAfterToolCall?.({} as never, {
            toolCall: {} as never,
            tool: undefined,
            toolName: 'read_a',
            toolCallId: 'call-10',
            ok: false,
            duration: 0,
            result: { error: 'Input validation failed for tool read_a' },
        });
        expect(decision).toEqual({ type: 'replaceResult', result: { error: 'invalid_args', message: 'Input validation failed for tool read_a' } });
        expect(
            middleware.onAfterToolCall?.({} as never, {
                toolCall: {} as never,
                tool: undefined,
                toolName: 'read_a',
                toolCallId: 'x',
                ok: true,
                duration: 1,
                result: {},
            }),
        ).toBeUndefined();
    });
});
