import { z } from 'zod';
import type { ChatMessage } from '@/lib/core/entity/assistant/conversation';
import { DEFAULT_ASSISTANT_CONFIG, type AssistantConfig } from '@/lib/core/entity/assistant/assistant-config';
import { createApprovalsController } from '@/lib/infrastructure/assistant/approvals-controller';
import {
    attachPageActionRegistry,
    getAttachedPageActionRegistry,
    subscribeToPageActionRegistry,
} from '@/lib/infrastructure/assistant/page-action-bridge';
import { createPageActionRegistry } from '@/lib/infrastructure/assistant/page-action-registry';
import { createPolicyFor } from '@/lib/infrastructure/assistant/policy-for';
import { registerTools, resetToolRegistryForTests } from '@/lib/infrastructure/assistant/tool-registry';
import { createNoopDataHandleStore } from '@/lib/infrastructure/assistant/noop-data-handle-store';
import { registerSignOutHook, runSignOutHooks } from '@/lib/infrastructure/auth/sign-out-hooks';
import { makeTool } from 'test/fixtures/assistant-fixtures';

describe('page action registry', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    const schema = z.object({ dids: z.array(z.string()).min(1), copies: z.coerce.number().int().min(1) });

    it('lists actions with a JSON schema and passes parsed args to apply', async () => {
        const registry = createPageActionRegistry();
        const apply = jest.fn(async (args: { dids: string[]; copies: number }) => `prefilled ${args.dids.length} DIDs, ${args.copies} copies`);
        const unregister = registry.register({ name: 'rule_create.prefill', description: 'Prefill', schema, apply });
        expect(registry.list()).toEqual([
            { name: 'rule_create.prefill', description: 'Prefill', inputJsonSchema: expect.objectContaining({ type: 'object' }) },
        ]);
        await expect(registry.invoke('rule_create.prefill', { dids: ['user.root:a'], copies: '2' })).resolves.toBe('prefilled 1 DIDs, 2 copies');
        expect(apply).toHaveBeenCalledWith({ dids: ['user.root:a'], copies: 2 });
        unregister();
        expect(registry.list()).toEqual([]);
    });

    it('throws ToolError shapes for unknown actions and bad args', async () => {
        const registry = createPageActionRegistry();
        registry.register({ name: 'rules.filter', description: 'Filter', schema, apply: async () => 'ok' });
        await expect(registry.invoke('nope', {})).rejects.toMatchObject({ error: 'not_found' });
        await expect(registry.invoke('rules.filter', { dids: [] })).rejects.toMatchObject({ error: 'invalid_args' });
    });

    it('resolves waitForActions on the next registration or on timeout', async () => {
        jest.useFakeTimers();
        const registry = createPageActionRegistry();
        const waiting = registry.waitForActions(5000);
        registry.register({ name: 'dids.search', description: 'Search', schema, apply: async () => 'ok' });
        await expect(waiting).resolves.toHaveLength(1);
        const timedOut = registry.waitForActions(100);
        jest.advanceTimersByTime(100);
        await expect(timedOut).resolves.toHaveLength(1);
    });

    it('caps describe() at 500 characters and survives a throwing describer', () => {
        const registry = createPageActionRegistry();
        registry.setDescriber(() => 'y'.repeat(800));
        expect(registry.describe()).toHaveLength(500);
        registry.setDescriber(() => {
            throw new Error('page not ready');
        });
        expect(registry.describe()).toBeUndefined();
    });

    it('is shared with pages through the bridge', () => {
        const registry = createPageActionRegistry();
        const detach = attachPageActionRegistry(registry);
        expect(getAttachedPageActionRegistry()).toBe(registry);
        detach();
        expect(getAttachedPageActionRegistry()).toBeNull();
    });

    it('ignores a stale detach once a newer registry is attached', () => {
        const first = createPageActionRegistry();
        const second = createPageActionRegistry();
        const detachFirst = attachPageActionRegistry(first);
        const detachSecond = attachPageActionRegistry(second);
        detachFirst();
        expect(getAttachedPageActionRegistry()).toBe(second);
        detachSecond();
        expect(getAttachedPageActionRegistry()).toBeNull();
    });

    it('notifies subscribers on attach and detach until they unsubscribe', () => {
        const listener = jest.fn();
        const unsubscribe = subscribeToPageActionRegistry(listener);
        const detach = attachPageActionRegistry(createPageActionRegistry());
        expect(listener).toHaveBeenCalledTimes(1);
        detach();
        expect(listener).toHaveBeenCalledTimes(2);
        unsubscribe();
        attachPageActionRegistry(null);
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('attach(null) clears the registry and its detach is a no-op', () => {
        const registry = createPageActionRegistry();
        attachPageActionRegistry(registry);
        const detachNull = attachPageActionRegistry(null);
        expect(getAttachedPageActionRegistry()).toBeNull();
        const detach = attachPageActionRegistry(registry);
        detachNull();
        expect(getAttachedPageActionRegistry()).toBe(registry);
        detach();
    });
});

describe('createPolicyFor', () => {
    beforeEach(() => {
        resetToolRegistryForTests();
        registerTools([makeTool('do_write', 'write', z.object({}), async () => ({})), makeTool('read_x', 'read', z.object({}), async () => ({}))]);
    });

    it('reads config, prefs and conversation approvals live at call time', () => {
        let config: AssistantConfig = { ...DEFAULT_ASSISTANT_CONFIG, writePolicyCap: 'allow' };
        const settings = { toolPolicies: { do_write: 'allow' as const } };
        const allow = new Set<string>();
        const policyFor = createPolicyFor(
            () => config,
            () => settings,
            () => allow,
        );
        expect(policyFor('do_write')).toBe('allow');
        config = { ...config, writePolicyCap: 'ask' };
        expect(policyFor('do_write')).toBe('ask');
        expect(policyFor('read_x')).toBe('allow');
        expect(policyFor('unknown_tool')).toBe('deny');
    });

    it('reacts to a live conversation-allow change', () => {
        const allow = new Set<string>();
        const policyFor = createPolicyFor(
            () => ({ ...DEFAULT_ASSISTANT_CONFIG, writePolicyCap: 'allow' }),
            () => ({ toolPolicies: {} }),
            () => allow,
        );
        expect(policyFor('do_write')).toBe('ask');
        allow.add('do_write');
        expect(policyFor('do_write')).toBe('allow');
        allow.delete('do_write');
        expect(policyFor('do_write')).toBe('ask');
    });

    it('never resolves a high-risk tool to allow', () => {
        registerTools([makeTool('do_high', 'high', z.object({}), async () => ({}))]);
        const policyFor = createPolicyFor(
            () => ({ ...DEFAULT_ASSISTANT_CONFIG, writePolicyCap: 'allow', highRiskPolicyCap: 'ask' }),
            () => ({ toolPolicies: { do_high: 'allow' as const } }),
            () => new Set(['do_high']),
        );
        expect(policyFor('do_high')).not.toBe('allow');
        expect(policyFor('do_high')).toBe('ask');
    });
});

describe('createApprovalsController', () => {
    it('expires every waiting call, records the decision and resolves the runner with false', () => {
        let message: ChatMessage = {
            id: 'a1',
            conversationId: 'c1',
            role: 'assistant',
            createdAt: 'x',
            parts: [{ type: 'tool-call', toolCallId: 't1', toolName: 'do_write', args: {}, policy: 'ask', status: 'awaiting-approval' }],
        };
        const resolveRunner = jest.fn();
        const emit = jest.fn();
        const controller = createApprovalsController({
            getMessage: () => message,
            setMessage: next => {
                message = next;
            },
            resolveRunner,
            approver: () => 'root@def',
            turnId: () => 'turn-1',
            emit,
        });
        expect(controller.expireOpen()).toEqual(['t1']);
        expect(message.parts[0]).toMatchObject({ status: 'expired' });
        expect(message.parts[1]).toMatchObject({ type: 'approval', decision: 'expired', approver: 'root@def' });
        expect(resolveRunner).toHaveBeenCalledWith('t1', false);
        expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool-approval', decision: 'expired', turnId: 'turn-1' }));
        expect(controller.expireOpen()).toEqual([]);
    });

    function awaiting(...ids: string[]): ChatMessage['parts'] {
        return ids.map(toolCallId => ({
            type: 'tool-call' as const,
            toolCallId,
            toolName: 'do_write',
            args: {},
            policy: 'ask' as const,
            status: 'awaiting-approval' as const,
        }));
    }

    it('expires only the waiting calls when several are open with mixed statuses', () => {
        let message: ChatMessage = {
            id: 'a1',
            conversationId: 'c1',
            role: 'assistant',
            createdAt: 'x',
            parts: [
                ...awaiting('t1'),
                { type: 'tool-call', toolCallId: 't2', toolName: 'read_x', args: {}, policy: 'allow', status: 'running' },
                ...awaiting('t3'),
                {
                    type: 'tool-call',
                    toolCallId: 't4',
                    toolName: 'read_x',
                    args: {},
                    policy: 'allow',
                    status: 'done',
                },
            ],
        };
        const resolveRunner = jest.fn();
        const controller = createApprovalsController({
            getMessage: () => message,
            setMessage: next => {
                message = next;
            },
            resolveRunner,
            approver: () => 'root@def',
            turnId: () => 'turn-1',
            emit: jest.fn(),
        });
        expect(controller.expireOpen()).toEqual(['t1', 't3']);
        const statuses = message.parts.flatMap(part => (part.type === 'tool-call' ? [[part.toolCallId, part.status]] : []));
        expect(statuses).toEqual([
            ['t1', 'expired'],
            ['t2', 'running'],
            ['t3', 'expired'],
            ['t4', 'done'],
        ]);
        expect(message.parts.filter(part => part.type === 'approval')).toHaveLength(2);
        expect(resolveRunner.mock.calls).toEqual([
            ['t1', false],
            ['t3', false],
        ]);
    });

    it('stores the message and resolves the runner even when an event sink throws', () => {
        let message: ChatMessage = { id: 'a1', conversationId: 'c1', role: 'assistant', createdAt: 'x', parts: awaiting('t1', 't2') };
        const resolveRunner = jest.fn();
        const controller = createApprovalsController({
            getMessage: () => message,
            setMessage: next => {
                message = next;
            },
            resolveRunner,
            approver: () => 'root@def',
            turnId: () => 'turn-1',
            emit: () => {
                throw new Error('sink down');
            },
        });
        expect(controller.expireOpen()).toEqual(['t1', 't2']);
        expect(message.parts.filter(part => part.type === 'tool-call').every(part => part.type === 'tool-call' && part.status === 'expired')).toBe(
            true,
        );
        expect(resolveRunner.mock.calls).toEqual([
            ['t1', false],
            ['t2', false],
        ]);
    });

    it('records the message and resolves the runner before any event is emitted', () => {
        let message: ChatMessage = { id: 'a1', conversationId: 'c1', role: 'assistant', createdAt: 'x', parts: awaiting('t1') };
        const order: string[] = [];
        const controller = createApprovalsController({
            getMessage: () => message,
            setMessage: next => {
                order.push('set');
                message = next;
            },
            resolveRunner: () => order.push('resolve'),
            approver: () => 'root@def',
            turnId: () => 'turn-1',
            emit: () => order.push('emit'),
        });
        controller.expireOpen();
        expect(order).toEqual(['set', 'resolve', 'emit']);
    });
});

describe('no-op data handle store', () => {
    it('holds nothing and refuses queries until phase 2', async () => {
        const store = createNoopDataHandleStore();
        expect(store.listHandles()).toEqual([]);
        await expect(store.memoryBytes()).resolves.toBe(0);
        await expect(store.query('select 1', { maxRows: 1 })).rejects.toThrow('SQL is not available');
    });
});

describe('sign-out hooks', () => {
    it('runs registered hooks, survives failures and stops waiting after the timeout', async () => {
        const order: string[] = [];
        const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const off1 = registerSignOutHook(async () => {
            order.push('a');
        });
        const off2 = registerSignOutHook(() => {
            throw new Error('broken');
        });
        const off3 = registerSignOutHook(() => new Promise<void>(() => undefined));
        await runSignOutHooks(50);
        expect(order).toEqual(['a']);
        off1();
        off2();
        off3();
        spy.mockRestore();
        await runSignOutHooks(10);
        expect(order).toEqual(['a']);
    });
});
