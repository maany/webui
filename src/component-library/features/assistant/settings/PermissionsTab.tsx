'use client';

import * as React from 'react';
import { Button } from '@/component-library/atoms/form/button';
import { Badge } from '@/component-library/atoms/misc/Badge';
import { cn } from '@/component-library/utils';
import type { AssistantConfig } from '@/lib/core/entity/assistant/assistant-config';
import type { ToolDomain, ToolPolicy, ToolPolicyPrefs, ToolRisk, ToolSpec } from '@/lib/core/entity/assistant/tool';
import {
    POLICY_ORDER,
    clampToCap,
    effectivePolicy,
    toolVisibility,
    type ToolVisibility,
    type ToolVisibilityContext,
} from '@/lib/core/services/assistant-policy';
import { TOOL_DOMAIN_LABELS, TOOL_DOMAIN_ORDER } from '@/lib/infrastructure/assistant/tool-domains';

export type PermissionToolInfo = Pick<ToolSpec, 'name' | 'domain' | 'description' | 'risk' | 'requires'>;
type Caps = Pick<AssistantConfig, 'writePolicyCap' | 'highRiskPolicyCap'>;

export interface PermissionsTabProps {
    tools: readonly PermissionToolInfo[];
    visibility: ToolVisibilityContext;
    config: Caps;
    prefs: ToolPolicyPrefs;
    onChange: (prefs: ToolPolicyPrefs) => void;
}

const POLICY_LABELS: Record<ToolPolicy, string> = { deny: 'Deny', ask: 'Ask', allow: 'Allow' };
const RISK_BADGE: Record<ToolRisk, { label: string; variant: 'neutral' | 'warning' | 'error' }> = {
    read: { label: 'Read', variant: 'neutral' },
    write: { label: 'Write', variant: 'warning' },
    high: { label: 'High risk', variant: 'error' },
};

const rank = (policy: ToolPolicy) => POLICY_ORDER.indexOf(policy);

export function capFor(risk: ToolRisk, config: Caps): ToolPolicy {
    if (risk === 'read') return 'allow';
    if (risk === 'write') return config.writePolicyCap;
    return clampToCap(config.highRiskPolicyCap, 'ask');
}

export function hiddenReasonLabel(
    tool: PermissionToolInfo,
    visibility: Extract<ToolVisibility, { visible: false }>,
    ctx: ToolVisibilityContext,
): string {
    if (visibility.reason === 'not-ready') return 'Checking your permissions';
    if (visibility.reason === 'role') return 'Admin only';
    if (tool.risk !== 'read' && !ctx.flags['assistant.write']) return 'Write tools are off';
    return 'Feature off';
}

interface PolicyChoiceProps {
    groupName: string;
    label: string;
    value: ToolPolicy | undefined;
    cap: ToolPolicy;
    offerAllow: boolean;
    onSelect: (policy: ToolPolicy) => void;
}

function PolicyChoice({ groupName, label, value, cap, offerAllow, onSelect }: PolicyChoiceProps) {
    const options = offerAllow ? POLICY_ORDER : POLICY_ORDER.filter(policy => policy !== 'allow');
    return (
        <fieldset className="w-full shrink-0 sm:w-auto">
            <legend className="sr-only">{label}</legend>
            <div className="flex w-full overflow-hidden rounded-md border border-neutral-300 dark:border-neutral-700 sm:inline-flex sm:w-auto">
                {options.map(option => {
                    const aboveCap = rank(option) > rank(cap);
                    return (
                        <label
                            key={option}
                            title={aboveCap ? 'Operator limit' : undefined}
                            className={cn('relative flex-1 sm:flex-none', aboveCap ? 'cursor-not-allowed' : 'cursor-pointer')}
                        >
                            <input
                                type="radio"
                                className="peer sr-only"
                                name={groupName}
                                value={option}
                                checked={value === option}
                                disabled={aboveCap}
                                onChange={() => onSelect(option)}
                            />
                            <span
                                className={cn(
                                    'flex min-h-11 items-center justify-center px-3 text-sm font-medium sm:min-h-9',
                                    'text-neutral-700 dark:text-neutral-300',
                                    'peer-checked:bg-brand-600 peer-checked:text-neutral-100',
                                    'peer-focus-visible:ring-2 peer-focus-visible:ring-inset peer-focus-visible:ring-brand-500',
                                    'peer-disabled:opacity-50',
                                )}
                            >
                                {POLICY_LABELS[option]}
                                {aboveCap && <span className="sr-only"> (Operator limit)</span>}
                            </span>
                        </label>
                    );
                })}
            </div>
        </fieldset>
    );
}

/** Settings tab: deny, ask or allow per tool and per domain. Users can only tighten the operator limits. */
export function PermissionsTab({ tools, visibility, config, prefs, onChange }: PermissionsTabProps) {
    const visible: PermissionToolInfo[] = [];
    const hidden: { tool: PermissionToolInfo; reason: string }[] = [];
    tools.forEach(tool => {
        const result = toolVisibility(tool, visibility);
        if (result.visible) visible.push(tool);
        else hidden.push({ tool, reason: hiddenReasonLabel(tool, result, visibility) });
    });

    const setToolPolicy = (name: string, policy: ToolPolicy) => onChange({ ...prefs, [name]: policy });
    const setGroupPolicy = (domain: ToolDomain, policy: ToolPolicy) => {
        // Only the tools shown here lose their own choice; a hidden tool keeps its choice for when it is shown again.
        const domainTools = new Set(visible.filter(tool => tool.domain === domain).map(tool => tool.name));
        const next: ToolPolicyPrefs = {};
        Object.entries(prefs).forEach(([key, value]) => {
            if (!domainTools.has(key)) next[key] = value;
        });
        next[`group:${domain}`] = policy;
        onChange(next);
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                    <p className="text-sm text-neutral-700 dark:text-neutral-300">
                        Choose what Rucio bot may do without asking. You can only make the operator limits stricter.
                    </p>
                    <p className="text-sm text-neutral-600 dark:text-neutral-400">
                        {`Operator limit: writes ${POLICY_LABELS[config.writePolicyCap]}, high-risk actions ${
                            POLICY_LABELS[config.highRiskPolicyCap]
                        }.`}
                    </p>
                </div>
                <Button variant="neutral" className="min-h-11 sm:min-h-10" onClick={() => onChange({})}>
                    Reset to defaults
                </Button>
            </div>

            {TOOL_DOMAIN_ORDER.map(domain => {
                const domainTools = visible.filter(tool => tool.domain === domain);
                if (domainTools.length === 0) return null;
                const groupCap = domainTools
                    .map(tool => capFor(tool.risk, config))
                    .reduce<ToolPolicy>((max, cap) => (rank(cap) > rank(max) ? cap : max), 'deny');
                const groupPref = prefs[`group:${domain}`];
                const groupOffersAllow = domainTools.some(tool => tool.risk !== 'high');
                const groupValue = groupPref ? clampToCap(groupPref, groupOffersAllow ? groupCap : clampToCap(groupCap, 'ask')) : undefined;
                const headingId = `permissions-${domain}`;
                return (
                    <section key={domain} aria-labelledby={headingId} className="rounded-lg border border-neutral-200 dark:border-neutral-700">
                        <div className="flex flex-col gap-2 border-b border-neutral-200 p-4 dark:border-neutral-700 sm:flex-row sm:items-center sm:justify-between">
                            <h3 id={headingId} className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                                {TOOL_DOMAIN_LABELS[domain]}
                            </h3>
                            <div className="space-y-1">
                                <PolicyChoice
                                    groupName={`group-${domain}`}
                                    label={`Policy for all ${TOOL_DOMAIN_LABELS[domain]} tools`}
                                    value={groupValue}
                                    cap={groupCap}
                                    offerAllow={groupOffersAllow}
                                    onSelect={policy => setGroupPolicy(domain, policy)}
                                />
                                <p className="text-xs text-neutral-600 dark:text-neutral-400">
                                    Applies to every tool in this group and replaces their individual choices.
                                </p>
                            </div>
                        </div>
                        <ul className="divide-y divide-neutral-200 dark:divide-neutral-700">
                            {domainTools.map(tool => (
                                <li key={tool.name} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="break-all font-mono text-sm text-neutral-900 dark:text-neutral-100">{tool.name}</span>
                                            <Badge size="sm" variant={RISK_BADGE[tool.risk].variant}>
                                                {RISK_BADGE[tool.risk].label}
                                            </Badge>
                                        </div>
                                        <p className="line-clamp-2 text-xs text-neutral-600 dark:text-neutral-400">{tool.description}</p>
                                    </div>
                                    <PolicyChoice
                                        groupName={`tool-${tool.name}`}
                                        label={`Policy for ${tool.name}`}
                                        value={effectivePolicy(tool, prefs, config)}
                                        cap={capFor(tool.risk, config)}
                                        offerAllow={tool.risk !== 'high'}
                                        onSelect={policy => setToolPolicy(tool.name, policy)}
                                    />
                                </li>
                            ))}
                        </ul>
                    </section>
                );
            })}

            {!visibility.permissionsReady && <p className="text-sm text-neutral-600 dark:text-neutral-400">Checking your permissions</p>}

            {visibility.permissionsReady && hidden.length > 0 && (
                <section aria-labelledby="permissions-hidden" className="space-y-2">
                    <h3 id="permissions-hidden" className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                        Hidden tools
                    </h3>
                    <p className="text-sm text-neutral-600 dark:text-neutral-400">These tools are not offered to Rucio bot.</p>
                    <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-700 dark:border-neutral-700">
                        {hidden.map(({ tool, reason }) => (
                            <li key={tool.name} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between">
                                <span className="break-all font-mono text-sm text-neutral-700 dark:text-neutral-300">{tool.name}</span>
                                <span className="text-sm text-neutral-600 dark:text-neutral-400">{reason}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
}
