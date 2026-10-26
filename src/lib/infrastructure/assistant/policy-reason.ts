import type { ToolPolicyPrefs, ToolSpec } from '@/lib/core/entity/assistant/tool';
import type { PolicyCaps } from './policy-for';
import { TOOL_DOMAIN_LABELS } from './tool-domains';

/** Why a tool call is waiting for approval, shown on the approval card. */
export function describePolicyReason(spec: Pick<ToolSpec, 'name' | 'risk' | 'domain'>, prefs: ToolPolicyPrefs, config: PolicyCaps): string {
    if (spec.risk === 'high') return 'High-risk action. It always needs your approval.';
    const own = prefs[spec.name];
    const group = prefs[`group:${spec.domain}`];
    const chosen = own ?? group;
    if (spec.risk === 'write' && chosen === 'allow' && config.writePolicyCap !== 'allow')
        return 'Your operator requires approval for changes to Rucio.';
    if (own === 'ask') return 'Your settings ask before running this tool.';
    if (own === undefined && group === 'ask') return `Your settings ask before running ${TOOL_DOMAIN_LABELS[spec.domain]} tools.`;
    if (spec.risk === 'write') return 'Changes to Rucio need your approval by default.';
    return 'Your settings ask before running this tool.';
}
