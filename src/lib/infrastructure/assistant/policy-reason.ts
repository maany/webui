import type { ToolPolicyPrefs, ToolSpec } from '@/lib/core/entity/assistant/tool';
import type { PolicyCaps } from './policy-for';
import { isToolPolicy } from '@/lib/core/services/assistant-policy';
import { TOOL_DOMAIN_LABELS } from './tool-domains';

/** Why a tool call is waiting for approval, shown on the approval card. */
export function describePolicyReason(spec: Pick<ToolSpec, 'name' | 'risk' | 'domain'>, prefs: ToolPolicyPrefs, config: PolicyCaps): string {
    if (spec.risk === 'high') return 'High-risk action. It always needs your approval.';
    // An invalid (tampered) value counts as unset, exactly as in effectivePolicy.
    const ownRaw = prefs[spec.name];
    const groupRaw = prefs[`group:${spec.domain}`];
    const own = isToolPolicy(ownRaw) ? ownRaw : undefined;
    const group = isToolPolicy(groupRaw) ? groupRaw : undefined;
    const chosen = own ?? group;
    if (spec.risk === 'write' && chosen === 'allow' && config.writePolicyCap !== 'allow')
        return 'Your operator requires approval for changes to Rucio.';
    if (own === 'ask') return 'Your settings ask before running this tool.';
    if (own === undefined && group === 'ask') return `Your settings ask before running ${TOOL_DOMAIN_LABELS[spec.domain]} tools.`;
    if (spec.risk === 'write') return 'Changes to Rucio need your approval by default.';
    return 'Your settings ask before running this tool.';
}
