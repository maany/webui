import {
    clampToCap,
    defaultPolicyFor,
    effectivePolicy,
    POLICY_ORDER,
    toolVisibility,
    type ToolVisibilityContext,
} from '@/lib/core/services/assistant-policy';
import type { ToolPolicy, ToolPolicyPrefs, ToolSpec } from '@/lib/core/entity/assistant/tool';
import type { AssistantConfig } from '@/lib/core/entity/assistant/assistant-config';
import { FEATURE_REGISTRY, type FeatureFlagMap, type FeatureKey } from '@/lib/core/entity/feature-config';
import { Role } from '@/lib/core/entity/auth-models';

type Spec = Pick<ToolSpec, 'name' | 'risk' | 'domain'>;
type Caps = Pick<AssistantConfig, 'writePolicyCap' | 'highRiskPolicyCap'>;

const listRules: Spec = { name: 'list_rules', risk: 'read', domain: 'rules' };
const createRule: Spec = { name: 'create_rule', risk: 'write', domain: 'rules' };
const deleteAccount: Spec = { name: 'delete_account', risk: 'high', domain: 'accounts' };
const OPEN: Caps = { writePolicyCap: 'allow', highRiskPolicyCap: 'ask' };
const DEFAULT_CAPS: Caps = { writePolicyCap: 'ask', highRiskPolicyCap: 'ask' };

describe('clampToCap', () => {
    it('orders policies deny < ask < allow', () => {
        expect(POLICY_ORDER).toEqual(['deny', 'ask', 'allow']);
    });

    it.each<[ToolPolicy, ToolPolicy, ToolPolicy]>([
        ['allow', 'allow', 'allow'],
        ['allow', 'ask', 'ask'],
        ['allow', 'deny', 'deny'],
        ['ask', 'allow', 'ask'],
        ['ask', 'deny', 'deny'],
        ['deny', 'allow', 'deny'],
    ])('clamps %s to cap %s as %s', (policy, cap, expected) => {
        expect(clampToCap(policy, cap)).toBe(expected);
    });

    it('treats unknown values as deny', () => {
        expect(clampToCap('yes' as ToolPolicy, 'allow')).toBe('deny');
        expect(clampToCap('allow', 'whatever' as ToolPolicy)).toBe('deny');
    });
});

describe('defaultPolicyFor', () => {
    it('allows reads and asks for writes and high-risk calls', () => {
        expect(defaultPolicyFor('read')).toBe('allow');
        expect(defaultPolicyFor('write')).toBe('ask');
        expect(defaultPolicyFor('high')).toBe('ask');
    });
});

describe('effectivePolicy', () => {
    it('uses the risk default without preferences', () => {
        expect(effectivePolicy(listRules, {}, DEFAULT_CAPS)).toBe('allow');
        expect(effectivePolicy(createRule, {}, DEFAULT_CAPS)).toBe('ask');
        expect(effectivePolicy(deleteAccount, {}, DEFAULT_CAPS)).toBe('ask');
    });

    it('prefers the tool preference over the group preference', () => {
        const prefs: ToolPolicyPrefs = { 'group:rules': 'deny', create_rule: 'allow' };
        expect(effectivePolicy(createRule, prefs, OPEN)).toBe('allow');
        expect(effectivePolicy({ name: 'update_rule', risk: 'write', domain: 'rules' }, prefs, OPEN)).toBe('deny');
    });

    it('lets users tighten reads, which are never clamped', () => {
        expect(effectivePolicy(listRules, { list_rules: 'deny' }, DEFAULT_CAPS)).toBe('deny');
        expect(effectivePolicy(listRules, { list_rules: 'ask' }, { writePolicyCap: 'deny', highRiskPolicyCap: 'deny' })).toBe('ask');
        expect(effectivePolicy(listRules, {}, { writePolicyCap: 'deny', highRiskPolicyCap: 'deny' })).toBe('allow');
    });

    it('applies a lowered write cap to a saved allow at read time', () => {
        const saved: ToolPolicyPrefs = { create_rule: 'allow' };
        expect(effectivePolicy(createRule, saved, OPEN)).toBe('allow');
        // The operator lowers the cap; the same saved preferences are evaluated again on the next call.
        expect(effectivePolicy(createRule, saved, { ...OPEN, writePolicyCap: 'ask' })).toBe('ask');
        expect(effectivePolicy(createRule, saved, { ...OPEN, writePolicyCap: 'deny' })).toBe('deny');
        // Raising it again restores the saved preference: nothing was rewritten.
        expect(effectivePolicy(createRule, saved, OPEN)).toBe('allow');
        expect(saved).toEqual({ create_rule: 'allow' });
    });

    it('ignores tampered preference values', () => {
        const tampered = { create_rule: 'always', 'group:rules': 'yes' } as unknown as ToolPolicyPrefs;
        expect(effectivePolicy(createRule, tampered, OPEN)).toBe('ask');
        const tamperedTool = { create_rule: 'nope', 'group:rules': 'deny' } as unknown as ToolPolicyPrefs;
        expect(effectivePolicy(createRule, tamperedTool, OPEN)).toBe('deny');
    });

    it('never allows high-risk tools, even with a tampered cap', () => {
        expect(effectivePolicy(deleteAccount, { delete_account: 'allow' }, DEFAULT_CAPS)).toBe('ask');
        const tamperedCaps = { writePolicyCap: 'allow', highRiskPolicyCap: 'allow' } as unknown as Caps;
        expect(effectivePolicy(deleteAccount, { delete_account: 'allow' }, tamperedCaps)).toBe('ask');
        expect(effectivePolicy(deleteAccount, {}, { writePolicyCap: 'allow', highRiskPolicyCap: 'deny' })).toBe('deny');
    });

    it('upgrades ask to allow for tools allowed in this conversation, still clamped', () => {
        const allowed = new Set(['create_rule', 'delete_account']);
        expect(effectivePolicy(createRule, {}, OPEN, allowed)).toBe('allow');
        expect(effectivePolicy(createRule, {}, DEFAULT_CAPS, allowed)).toBe('ask');
        expect(effectivePolicy(createRule, { create_rule: 'deny' }, OPEN, allowed)).toBe('deny');
    });

    it('never upgrades high-risk tools for the conversation', () => {
        expect(effectivePolicy(deleteAccount, {}, OPEN, new Set(['delete_account']))).toBe('ask');
    });

    it('denies tools with an unknown risk', () => {
        expect(effectivePolicy({ name: 'x', risk: 'extreme' as ToolSpec['risk'], domain: 'core' }, {}, OPEN)).toBe('deny');
    });
});

describe('toolVisibility', () => {
    const allFlags = (overrides: Partial<FeatureFlagMap> = {}): FeatureFlagMap => {
        const map = {} as FeatureFlagMap;
        (Object.keys(FEATURE_REGISTRY) as FeatureKey[]).forEach(key => {
            map[key] = true;
        });
        return { ...map, ...overrides };
    };
    const ctx = (overrides: Partial<ToolVisibilityContext> = {}): ToolVisibilityContext => ({
        flags: allFlags(),
        role: Role.USER,
        permissionsReady: true,
        ...overrides,
    });
    const read = { risk: 'read' as const, requires: { flags: ['rules'] as FeatureKey[] } };
    const write = { risk: 'write' as const, requires: { flags: ['rules.create'] as FeatureKey[] } };
    const admin = { risk: 'high' as const, requires: { flags: ['accounts.manage'] as FeatureKey[], role: Role.ADMIN } };

    it('shows a read tool whose flags are on', () => {
        expect(toolVisibility(read, ctx())).toEqual({ visible: true });
    });

    it('hides everything until permissions are ready', () => {
        expect(toolVisibility(read, ctx({ permissionsReady: false }))).toEqual({ visible: false, reason: 'not-ready' });
    });

    it('hides a tool whose route flag is off', () => {
        expect(toolVisibility(read, ctx({ flags: allFlags({ rules: false }) }))).toEqual({ visible: false, reason: 'flag' });
    });

    it('hides writes while assistant.write is off', () => {
        expect(toolVisibility(write, ctx({ flags: allFlags({ 'assistant.write': false }) }))).toEqual({ visible: false, reason: 'flag' });
        expect(toolVisibility(read, ctx({ flags: allFlags({ 'assistant.write': false }) }))).toEqual({ visible: true });
    });

    it('hides admin tools from non-admins and unknown roles', () => {
        expect(toolVisibility(admin, ctx())).toEqual({ visible: false, reason: 'role' });
        expect(toolVisibility(admin, ctx({ role: undefined }))).toEqual({ visible: false, reason: 'role' });
        expect(toolVisibility(admin, ctx({ role: Role.ADMIN }))).toEqual({ visible: true });
    });

    it('reports a flag before a role', () => {
        expect(toolVisibility(admin, ctx({ flags: allFlags({ 'accounts.manage': false }) }))).toEqual({ visible: false, reason: 'flag' });
    });
});
