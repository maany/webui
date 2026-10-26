import { z } from 'zod';
import { Role } from '@/lib/core/entity/auth-models';
import type { ToolPolicy, ToolPolicyPrefs, ToolSpec } from '@/lib/core/entity/assistant/tool';
import { toolVisibility, type ToolVisibilityContext } from '@/lib/core/services/assistant-policy';
import { createPolicyFor, type PolicyCaps } from '@/lib/infrastructure/assistant/policy-for';
import { describePolicyReason } from '@/lib/infrastructure/assistant/policy-reason';
import { registerTools, resetToolRegistryForTests } from '@/lib/infrastructure/assistant/tool-registry';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import { ALL_FLAGS_ON, flagsWithout } from 'test/fixtures/assistant-write-fixtures';

function tool(name: string, risk: ToolSpec['risk'], domain: ToolSpec['domain'], requires: ToolSpec['requires']): RegisteredTool<unknown> {
    return {
        spec: {
            name,
            domain,
            description: name,
            input: z.unknown(),
            risk,
            requires,
            executor: 'feature',
            output: 'object',
            describeCall: () => name,
        },
        execute: jest.fn(),
    };
}

const listRules = tool('list_rules', 'read', 'rules', { flags: ['rules'] });
const createRule = tool('create_rule', 'write', 'rules', { flags: ['rules.create'] });
const deleteAccount = tool('delete_account', 'high', 'accounts', { flags: ['accounts.manage'], role: Role.ADMIN });

interface GateState {
    config: PolicyCaps | undefined;
    prefs: ToolPolicyPrefs;
    conversationAllow: string[];
    visibility: ToolVisibilityContext;
}

let state: GateState;

/** The policyFor that Task 10 wires into AssistantProvider, reading `state` on every call. */
function gate(withVisibility = true): (toolName: string) => ToolPolicy {
    return createPolicyFor(
        () => state.config,
        () => ({ toolPolicies: state.prefs }),
        () => new Set(state.conversationAllow),
        withVisibility ? { isVisible: spec => toolVisibility(spec, state.visibility).visible } : {},
    );
}

beforeEach(() => {
    resetToolRegistryForTests();
    registerTools([listRules, createRule, deleteAccount]);
    state = {
        config: { writePolicyCap: 'ask', highRiskPolicyCap: 'ask' },
        prefs: {},
        conversationAllow: [],
        visibility: { flags: ALL_FLAGS_ON, role: Role.ADMIN, permissionsReady: true },
    };
});

describe('createPolicyFor with the phase 4 options', () => {
    it('denies unknown tools and uses the defaults: reads allow, writes ask, high risk ask', () => {
        const policyFor = gate();
        expect(policyFor('unknown_tool')).toBe('deny');
        expect(policyFor('list_rules')).toBe('allow');
        expect(policyFor('create_rule')).toBe('ask');
        expect(policyFor('delete_account')).toBe('ask');
    });

    it('fails closed for writes while the operator config is not loaded', () => {
        state.config = undefined;
        state.prefs = { create_rule: 'allow' };
        const policyFor = gate();
        expect(policyFor('create_rule')).toBe('deny');
        expect(policyFor('delete_account')).toBe('deny');
        expect(policyFor('list_rules')).toBe('allow');
    });

    it('lets "allow for this conversation" upgrade writes up to the cap, never high risk', () => {
        state.config = { writePolicyCap: 'allow', highRiskPolicyCap: 'ask' };
        state.conversationAllow = ['create_rule', 'delete_account'];
        const policyFor = gate();
        expect(policyFor('create_rule')).toBe('allow');
        expect(policyFor('delete_account')).toBe('ask');
        state.config = { writePolicyCap: 'ask', highRiskPolicyCap: 'ask' };
        expect(policyFor('create_rule')).toBe('ask');
    });

    it('denies tools that are not visible', () => {
        const policyFor = gate();
        state.visibility = { flags: flagsWithout('assistant.write'), role: Role.ADMIN, permissionsReady: true };
        expect(policyFor('create_rule')).toBe('deny');
        state.visibility = { flags: ALL_FLAGS_ON, role: Role.USER, permissionsReady: true };
        expect(policyFor('delete_account')).toBe('deny');
        state.visibility = { flags: ALL_FLAGS_ON, role: Role.ADMIN, permissionsReady: false };
        expect(policyFor('list_rules')).toBe('deny');
    });

    it('keeps the phase 1b behaviour when no visibility check is given', () => {
        state.visibility = { flags: flagsWithout('assistant.write'), role: Role.USER, permissionsReady: false };
        expect(gate(false)('create_rule')).toBe('ask');
    });
});

describe('createPolicyFor reads live state (Review Focus 4)', () => {
    it('applies cap and preference changes on the next call', () => {
        state.config = { writePolicyCap: 'allow', highRiskPolicyCap: 'ask' };
        state.prefs = { create_rule: 'allow' };
        const policyFor = gate();
        expect(policyFor('create_rule')).toBe('allow');

        state.config = { writePolicyCap: 'ask', highRiskPolicyCap: 'ask' };
        expect(policyFor('create_rule')).toBe('ask');

        state.config = { writePolicyCap: 'allow', highRiskPolicyCap: 'ask' };
        state.prefs = { create_rule: 'deny' };
        expect(policyFor('create_rule')).toBe('deny');

        state.prefs = { 'group:rules': 'deny' };
        expect(policyFor('create_rule')).toBe('deny');
        expect(policyFor('list_rules')).toBe('deny');
    });

    it('clamps a tampered allow on a high-risk tool', () => {
        state.prefs = { delete_account: 'allow' };
        expect(gate()('delete_account')).toBe('ask');
    });
});

describe('describePolicyReason', () => {
    const caps = { writePolicyCap: 'ask' as const, highRiskPolicyCap: 'ask' as const };

    it('explains each source of an ask', () => {
        expect(describePolicyReason(deleteAccount.spec, {}, caps)).toBe('High-risk action. It always needs your approval.');
        expect(describePolicyReason(createRule.spec, { create_rule: 'allow' }, caps)).toBe('Your operator requires approval for changes to Rucio.');
        expect(describePolicyReason(createRule.spec, { create_rule: 'ask' }, { ...caps, writePolicyCap: 'allow' })).toBe(
            'Your settings ask before running this tool.',
        );
        expect(describePolicyReason(createRule.spec, { 'group:rules': 'ask' }, { ...caps, writePolicyCap: 'allow' })).toBe(
            'Your settings ask before running Rules tools.',
        );
        expect(describePolicyReason(createRule.spec, {}, caps)).toBe('Changes to Rucio need your approval by default.');
        expect(describePolicyReason(listRules.spec, { list_rules: 'ask' }, caps)).toBe('Your settings ask before running this tool.');
    });

    it('treats an invalid own preference like the effective policy does and falls back to the group', () => {
        const prefs = { create_rule: 'bogus', 'group:rules': 'ask' } as unknown as ToolPolicyPrefs;
        expect(describePolicyReason(createRule.spec, prefs, { ...caps, writePolicyCap: 'allow' })).toBe(
            'Your settings ask before running Rules tools.',
        );
        const groupAllow = { create_rule: 'bogus', 'group:rules': 'allow' } as unknown as ToolPolicyPrefs;
        expect(describePolicyReason(createRule.spec, groupAllow, caps)).toBe('Your operator requires approval for changes to Rucio.');
    });
});
