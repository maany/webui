import { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import type { ToolSpec } from '@/lib/core/entity/assistant/tool';
import { createFeatureTool } from '@/lib/infrastructure/assistant/feature-executor';
import { refreshHandle } from '@/lib/infrastructure/assistant/refresh-handle';
import { deniedByPolicy } from '@/lib/infrastructure/assistant/tanstack-tools';
import { UNAVAILABLE_REASONS, toolUnavailableReason } from '@/lib/infrastructure/assistant/tool-availability';
import { registerTools } from '@/lib/infrastructure/assistant/tool-registry';
import type { ToolExecutionContext } from '@/lib/infrastructure/assistant/tool-types';
import { findToolsTool } from '@/lib/infrastructure/assistant/tools/core-tools';
import { makeNoopHandles } from 'test/fixtures/assistant-fixtures';

const EM_DASH = String.fromCharCode(0x2014);

const spec = (name: string, domain: ToolSpec['domain'], description: string, extra: Partial<ToolSpec<Record<string, unknown>>> = {}) =>
    ({
        name,
        domain,
        description,
        input: z.object({}),
        risk: 'read',
        requires: { flags: [] },
        executor: 'feature',
        output: 'rows',
        route: { path: `/api/feature/${name.replace(/_/g, '-')}`, method: 'GET' },
        describeCall: () => name,
        ...extra,
    } as ToolSpec<Record<string, unknown>>);

registerTools([
    createFeatureTool(spec('list_rules', 'rules', 'List replication rules with their state.')),
    createFeatureTool(
        spec('create_rule', 'rules', 'Create a replication rule for DIDs on an RSE expression.', {
            risk: 'write',
            route: { path: '/api/feature/create-rule', method: 'POST' },
        }),
    ),
    createFeatureTool(spec('list_accounts', 'accounts', 'List accounts. Admins only.')),
    findToolsTool,
]);

function context(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
    return {
        signal: new AbortController().signal,
        conversationId: 'c1',
        turnId: 't1',
        toolCallId: 'call-1',
        accountKey: 'root@def',
        handles: makeNoopHandles(),
        pages: { list: () => [] } as unknown as ToolExecutionContext['pages'],
        navigate: jest.fn(),
        queryClient: new QueryClient(),
        emit: jest.fn(),
        activateTools: jest.fn(),
        ...overrides,
    };
}

type FindResult = { tools: { name: string }[]; unavailable?: { name: string; reason: string }[]; note: string };

describe('toolUnavailableReason', () => {
    const write = { name: 'create_rule', domain: 'rules', risk: 'write' } as const;

    it('is undefined for a visible tool that is not denied', () => {
        expect(toolUnavailableReason(write, { visibility: { visible: true }, policy: 'ask', prefs: {} })).toBeUndefined();
    });

    it('says the feature is disabled on this server when a flag is off', () => {
        expect(toolUnavailableReason(write, { visibility: { visible: false, reason: 'flag' }, policy: 'deny', prefs: {} })).toBe(
            UNAVAILABLE_REASONS.server,
        );
        expect(UNAVAILABLE_REASONS.server).toBe('disabled on this server');
    });

    it('says the account is not permitted for a role restriction', () => {
        expect(toolUnavailableReason(write, { visibility: { visible: false, reason: 'role' }, policy: 'deny', prefs: {} })).toBe(
            'not permitted for your account',
        );
    });

    it('points at the Rucio bot permissions when the user turned the tool or its group off', () => {
        expect(toolUnavailableReason(write, { visibility: { visible: true }, policy: 'deny', prefs: { create_rule: 'deny' } })).toBe(
            'turned off in your Rucio bot permissions',
        );
        expect(toolUnavailableReason(write, { visibility: { visible: true }, policy: 'deny', prefs: { 'group:rules': 'deny' } })).toBe(
            'turned off in your Rucio bot permissions',
        );
    });

    it('blames the server when the operator cap denies a tool the user allowed', () => {
        expect(toolUnavailableReason(write, { visibility: { visible: true }, policy: 'deny', prefs: { create_rule: 'allow' } })).toBe(
            'disabled on this server',
        );
    });

    it('asks to try again while permissions are still loading', () => {
        expect(toolUnavailableReason(write, { visibility: { visible: false, reason: 'not-ready' }, policy: 'deny', prefs: {} })).toMatch(
            /not available yet/,
        );
        expect(toolUnavailableReason(write, { visibility: { visible: true }, policy: 'deny', prefs: {}, capsLoaded: false })).toMatch(
            /not available yet/,
        );
    });

    it('uses no em dashes', () => {
        expect(Object.values(UNAVAILABLE_REASONS).join(' ')).not.toContain(EM_DASH);
    });
});

describe('find_tools availability', () => {
    const reasons: Record<string, string> = { create_rule: 'disabled on this server', list_accounts: 'not permitted for your account' };
    const visible = (name: string) => name === 'list_rules';

    it('reports matching tools that exist but are unavailable, with a short reason, and does not load them', async () => {
        const ctx = context({ isToolVisible: visible, unavailableReason: name => reasons[name] });
        const result = (await findToolsTool.execute({ query: 'create rule' }, ctx)) as FindResult;
        expect(result.unavailable).toEqual([{ name: 'create_rule', reason: 'disabled on this server' }]);
        expect(result.tools.map(tool => tool.name)).not.toContain('create_rule');
        expect(ctx.activateTools).not.toHaveBeenCalledWith(expect.arrayContaining(['create_rule']));
        expect(result.note).toMatch(/tell the user/i);
        expect(result.note).not.toContain(EM_DASH);
    });

    it('does not load a visible tool the user turned off, and says why', async () => {
        const ctx = context({
            isToolVisible: () => true,
            unavailableReason: name => (name === 'create_rule' ? 'turned off in your Rucio bot permissions' : undefined),
        });
        const result = (await findToolsTool.execute({ query: 'create rule' }, ctx)) as FindResult;
        expect(result.unavailable).toEqual([{ name: 'create_rule', reason: 'turned off in your Rucio bot permissions' }]);
        expect(result.tools.map(tool => tool.name)).not.toContain('create_rule');
    });

    it('still loads the available matches next to the unavailable ones', async () => {
        const ctx = context({ isToolVisible: visible, unavailableReason: name => reasons[name] });
        const result = (await findToolsTool.execute({ query: 'rules' }, ctx)) as FindResult;
        expect(result.tools.map(tool => tool.name)).toContain('list_rules');
        expect(ctx.activateTools).toHaveBeenCalledWith(expect.arrayContaining(['list_rules']));
    });

    it('keeps hidden tools out of the answer when no reason source is wired', async () => {
        const ctx = context({ isToolVisible: visible });
        const result = (await findToolsTool.execute({ query: 'create rule' }, ctx)) as FindResult;
        expect(result.unavailable ?? []).toEqual([]);
        expect(JSON.stringify(result)).not.toContain('create_rule');
    });
});

describe('gate errors', () => {
    it('deniedByPolicy carries the reason and tells the model to report it', () => {
        const denied = deniedByPolicy('create_rule', 'disabled on this server');
        expect(denied).toEqual({ error: 'denied_by_policy', message: expect.stringContaining('create_rule is disabled on this server') });
        expect(denied.message).toMatch(/tell the user/i);
        expect(deniedByPolicy('create_rule').message).toMatch(/tell the user/i);
    });

    it('does not forbid a retry while the settings are still loading', () => {
        const denied = deniedByPolicy('create_rule', UNAVAILABLE_REASONS.loading);
        expect(denied.message).toContain('try again in a moment');
        expect(denied.message).not.toMatch(/do not retry/i);
        expect(denied.errorType).toBe('not_ready');
    });

    it('refresh_handle names the reason when the tool behind a handle is unavailable', async () => {
        const result = await refreshHandle('rules_1', {
            records: [
                {
                    name: 'rules_1',
                    toolName: 'list_rules',
                    args: {},
                    createdAt: '2026-10-25T10:00:00.000Z',
                } as never,
            ],
            handles: makeNoopHandles(),
            signal: new AbortController().signal,
            expectedAccount: 'root@def',
            isToolVisible: () => false,
            unavailableReason: () => 'not permitted for your account',
        });
        expect(result).toMatchObject({ error: 'forbidden', message: expect.stringContaining('not permitted for your account') });
    });
});
