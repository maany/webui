import type { AssistantConfig } from '@/lib/core/entity/assistant/assistant-config';
import type { AssistantSettings } from '@/lib/core/entity/assistant/settings';
import type { ToolPolicy } from '@/lib/core/entity/assistant/tool';
import { effectivePolicy } from '@/lib/core/services/assistant-policy';
import { getTool } from './tool-registry';

/**
 * The runner's live `policyFor`: every call reads the current operator config,
 * user preferences and conversation approvals, so a lowered cap applies to the
 * very next tool call. Unknown tools are denied.
 */
export function createPolicyFor(
    getConfig: () => Pick<AssistantConfig, 'writePolicyCap' | 'highRiskPolicyCap'>,
    getSettings: () => Pick<AssistantSettings, 'toolPolicies'>,
    getConversationAllow: () => ReadonlySet<string>,
): (toolName: string) => ToolPolicy {
    return toolName => {
        const tool = getTool(toolName);
        if (!tool) return 'deny';
        return effectivePolicy(tool.spec, getSettings().toolPolicies, getConfig(), getConversationAllow());
    };
}
