import type { AssistantConfig } from '@/lib/core/entity/assistant/assistant-config';
import type { AssistantSettings } from '@/lib/core/entity/assistant/settings';
import type { ToolPolicy, ToolSpec } from '@/lib/core/entity/assistant/tool';
import { effectivePolicy } from '@/lib/core/services/assistant-policy';
import { getTool } from './tool-registry';

export type PolicyCaps = Pick<AssistantConfig, 'writePolicyCap' | 'highRiskPolicyCap'>;

/** Caps used while the operator config is loading or failed to load: writes and high-risk tools are denied. */
export const FAIL_CLOSED_CAPS: PolicyCaps = { writePolicyCap: 'deny', highRiskPolicyCap: 'deny' };

export interface PolicyForOptions {
    /** False for a tool the user cannot see right now (flag off, not an admin, permissions not loaded). Such tools are denied. */
    isVisible?(spec: Pick<ToolSpec, 'requires' | 'risk'>): boolean;
}

/**
 * The runner's live `policyFor`: every call reads the current operator config,
 * user preferences and conversation approvals, so a lowered cap applies to the
 * very next tool call. Unknown tools are denied. `getConfig` returns undefined
 * while the operator config is not loaded; writes then fail closed.
 */
export function createPolicyFor(
    getConfig: () => PolicyCaps | undefined,
    getSettings: () => Pick<AssistantSettings, 'toolPolicies'>,
    getConversationAllow: () => ReadonlySet<string>,
    options: PolicyForOptions = {},
): (toolName: string) => ToolPolicy {
    return toolName => {
        const tool = getTool(toolName);
        if (!tool) return 'deny';
        if (options.isVisible && !options.isVisible(tool.spec)) return 'deny';
        return effectivePolicy(tool.spec, getSettings().toolPolicies, getConfig() ?? FAIL_CLOSED_CAPS, getConversationAllow());
    };
}
