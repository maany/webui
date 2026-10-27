import type { ToolPolicy, ToolPolicyPrefs, ToolSpec } from '@/lib/core/entity/assistant/tool';
import { isToolPolicy, type ToolVisibility } from '@/lib/core/services/assistant-policy';

/**
 * Short, user-facing reasons a tool cannot be used. They complete "<tool> is ..." and never name flags, roles or
 * config keys, so the model can pass them on as they are.
 */
export const UNAVAILABLE_REASONS = {
    server: 'disabled on this server',
    account: 'not permitted for your account',
    permissions: 'turned off in your Rucio bot permissions',
    loading: 'not available yet because your account and Rucio bot settings are still loading; try again in a moment',
} as const;

export interface ToolAvailabilityInput {
    visibility: ToolVisibility;
    /** Live effective policy of the tool. */
    policy: ToolPolicy;
    /** The user's tool permissions (Rucio bot settings). */
    prefs: ToolPolicyPrefs;
    /** False while the operator config has not loaded: writes are denied then, which is not a real setting. */
    capsLoaded?: boolean;
}

/** Why a tool cannot be used right now, or undefined when it can (even if it asks for approval first). */
export function toolUnavailableReason(spec: Pick<ToolSpec, 'name' | 'domain' | 'risk'>, input: ToolAvailabilityInput): string | undefined {
    const { visibility } = input;
    if (!visibility.visible) {
        if (visibility.reason === 'role') return UNAVAILABLE_REASONS.account;
        if (visibility.reason === 'not-ready') return UNAVAILABLE_REASONS.loading;
        return UNAVAILABLE_REASONS.server;
    }
    if (input.policy !== 'deny') return undefined;
    // Same precedence as effectivePolicy: the tool's own setting, else its group; invalid values count as unset.
    const own = input.prefs[spec.name];
    const chosen = isToolPolicy(own) ? own : input.prefs[`group:${spec.domain}`];
    if (chosen === 'deny') return UNAVAILABLE_REASONS.permissions;
    if (input.capsLoaded === false && spec.risk !== 'read') return UNAVAILABLE_REASONS.loading;
    return UNAVAILABLE_REASONS.server;
}
