import { Role } from '@/lib/core/entity/auth-models';
import type { FeatureFlagMap } from '@/lib/core/entity/feature-config';
import type { AssistantConfig } from '@/lib/core/entity/assistant/assistant-config';
import { TOOL_POLICIES, type ToolPolicy, type ToolPolicyPrefs, type ToolRisk, type ToolSpec } from '@/lib/core/entity/assistant/tool';

export const POLICY_ORDER: readonly ToolPolicy[] = TOOL_POLICIES;

function isToolPolicy(value: unknown): value is ToolPolicy {
    return typeof value === 'string' && (POLICY_ORDER as readonly string[]).includes(value);
}

/** The stricter of policy and cap. Unknown values (tampered storage or config) count as deny. */
export function clampToCap(policy: ToolPolicy, cap: ToolPolicy): ToolPolicy {
    const policyRank = POLICY_ORDER.indexOf(policy);
    const capRank = POLICY_ORDER.indexOf(cap);
    if (policyRank < 0 || capRank < 0) return 'deny';
    return POLICY_ORDER[Math.min(policyRank, capRank)];
}

export function defaultPolicyFor(risk: ToolRisk): ToolPolicy {
    return risk === 'read' ? 'allow' : 'ask';
}

/**
 * The policy for one tool call. Pure and uncached: call it on every tool call so a lowered
 * operator cap or an edited preference applies immediately.
 * Precedence: prefs[name] ?? prefs[`group:${domain}`] ?? defaultPolicyFor(risk); then
 * conversationAllow upgrades 'ask' to 'allow' (never for 'high'); then the cap for the risk.
 * High-risk tools are additionally capped at 'ask' (v1 never allows them).
 */
export function effectivePolicy(
    spec: Pick<ToolSpec, 'name' | 'risk' | 'domain'>,
    prefs: ToolPolicyPrefs,
    config: Pick<AssistantConfig, 'writePolicyCap' | 'highRiskPolicyCap'>,
    conversationAllow?: ReadonlySet<string>,
): ToolPolicy {
    const own = prefs[spec.name];
    const group = prefs[`group:${spec.domain}`];
    let policy: ToolPolicy = isToolPolicy(own) ? own : isToolPolicy(group) ? group : defaultPolicyFor(spec.risk);
    if (policy === 'ask' && spec.risk !== 'high' && conversationAllow?.has(spec.name)) {
        policy = 'allow';
    }
    switch (spec.risk) {
        case 'read':
            return policy;
        case 'write':
            return clampToCap(policy, config.writePolicyCap);
        case 'high':
            return clampToCap(clampToCap(policy, config.highRiskPolicyCap), 'ask');
        default:
            return 'deny';
    }
}

export interface ToolVisibilityContext {
    flags: FeatureFlagMap;
    role: Role | undefined;
    permissionsReady: boolean;
}

export type ToolVisibility = { visible: true } | { visible: false; reason: 'flag' | 'role' | 'not-ready' };

/** Whether a tool may be offered to the model at all. Hidden tools are never sent. */
export function toolVisibility(spec: Pick<ToolSpec, 'requires' | 'risk'>, ctx: ToolVisibilityContext): ToolVisibility {
    if (!ctx.permissionsReady) return { visible: false, reason: 'not-ready' };
    if (spec.requires.flags.some(flag => !ctx.flags[flag])) return { visible: false, reason: 'flag' };
    if (spec.risk !== 'read' && !ctx.flags['assistant.write']) return { visible: false, reason: 'flag' };
    if (spec.requires.role === Role.ADMIN && ctx.role !== Role.ADMIN) return { visible: false, reason: 'role' };
    return { visible: true };
}
