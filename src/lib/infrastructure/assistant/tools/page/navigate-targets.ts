import { z } from 'zod';
import type { FeatureFlagMap, FeatureKey } from '@/lib/core/entity/feature-config';
import { Role } from '@/lib/core/entity/auth-models';
import { RuleState } from '@/lib/core/entity/rucio';
import type { ToolError } from '@/lib/core/entity/assistant/tool';
import { ACCOUNT_TABS } from '@/component-library/pages/Account/details/details-account-types';
import {
    buildAccountDetailUrl,
    buildAccountsListUrl,
    buildAssistantSettingsUrl,
    buildDashboardUrl,
    buildDIDDetailUrl,
    buildDIDSearchUrl,
    buildRSEDetailUrl,
    buildRSESearchUrl,
    buildRuleCreateUrl,
    buildRuleDetailUrl,
    buildRuleSearchUrl,
    buildSubscriptionDetailUrl,
    buildSubscriptionSearchUrl,
} from '@/lib/infrastructure/utils/navigation';
import { DATE_PARAM, DID_TYPE_NAMES, didTypeFromName, ruleSearchFilters } from '@/lib/infrastructure/assistant/page-url-params';
import { isToolError, toolError } from '@/lib/infrastructure/assistant/page-tool-errors';

export const NAVIGATE_PAGES = [
    'dashboard',
    'dids',
    'did',
    'rules',
    'rule',
    'rule_create',
    'rses',
    'rse',
    'subscriptions',
    'subscription',
    'accounts',
    'account',
    'assistant_settings',
] as const;
export type NavigatePage = (typeof NAVIGATE_PAGES)[number];

export const NavigateParamsSchema = z.object({
    scope: z.string().min(1).optional().describe('DID scope (did, dids, rules)'),
    name: z
        .string()
        .min(1)
        .optional()
        .describe('DID name (did, dids, rules) or subscription name (subscription). * wildcards work on dids and rules'),
    type: z.enum(DID_TYPE_NAMES).optional().describe('DID type for dids: all (default), dataset, container or file'),
    id: z.string().min(1).optional().describe('Rule id (rule)'),
    rse: z.string().min(1).optional().describe('RSE name (rse)'),
    expression: z.string().min(1).optional().describe('RSE expression (rses)'),
    account: z.string().min(1).optional().describe('Account name (account, subscription, subscriptions, rules)'),
    tab: z.enum(ACCOUNT_TABS).optional().describe('Tab of the account page'),
    activity: z.string().min(1).optional().describe('Rule activity (rules)'),
    state: z.enum(RuleState).optional().describe('Rule state (rules)'),
    updatedAfter: DATE_PARAM.optional().describe('Rules updated after this day, YYYY-MM-DD'),
    updatedBefore: DATE_PARAM.optional().describe('Rules updated before this day, YYYY-MM-DD'),
});
export type NavigateParams = z.infer<typeof NavigateParamsSchema>;

export const NavigateInputSchema = z.object({
    page: z.enum(NAVIGATE_PAGES).describe('Which page to open'),
    params: NavigateParamsSchema.optional(),
});
export type NavigateInput = z.infer<typeof NavigateInputSchema>;

export interface NavigateTarget {
    url: string;
    pathname: string;
    label: string;
    /** Prefix of the page actions this page registers, e.g. 'rules' for 'rules.filter'. */
    actionPrefix?: string;
}

export interface NavigateEnv {
    flags?: Partial<FeatureFlagMap>;
    role?: Role;
    /** Account of the signed-in user. */
    account: string;
}

const PAGE_FLAGS: Record<NavigatePage, FeatureKey | undefined> = {
    dashboard: undefined,
    dids: undefined,
    did: undefined,
    rules: 'rules',
    rule: 'rules',
    rule_create: 'rules.create',
    rses: 'rses',
    rse: 'rses',
    subscriptions: 'subscriptions',
    subscription: 'subscriptions',
    accounts: 'accounts',
    account: 'accounts',
    assistant_settings: 'assistant',
};

const ACTION_PREFIX: Partial<Record<NavigatePage, string>> = {
    dids: 'dids',
    rules: 'rules',
    rses: 'rses',
    subscriptions: 'subscriptions',
    rule_create: 'rule_create',
};

function missing(page: NavigatePage, names: string[]): ToolError {
    return toolError('invalid_args', `Opening ${page} needs params.${names.join(' and params.')}.`);
}

function build(page: NavigatePage, params: NavigateParams): { url: string; label: string } | ToolError {
    switch (page) {
        case 'dashboard':
            return { url: buildDashboardUrl(), label: 'the dashboard' };
        case 'dids': {
            if (!params.scope) return { url: buildDIDSearchUrl({}), label: 'the DID search' };
            const name = params.name ?? '*';
            return {
                url: buildDIDSearchUrl({ scope: params.scope, name, type: didTypeFromName(params.type) }),
                label: `the DID search for ${params.scope}:${name}`,
            };
        }
        case 'did':
            if (!params.scope || !params.name) return missing(page, ['scope', 'name']);
            return { url: buildDIDDetailUrl(params.scope, params.name), label: `DID ${params.scope}:${params.name}` };
        case 'rules':
            return { url: buildRuleSearchUrl(ruleSearchFilters(params)), label: 'the rule list' };
        case 'rule':
            if (!params.id) return missing(page, ['id']);
            return { url: buildRuleDetailUrl(params.id), label: `rule ${params.id}` };
        case 'rule_create':
            return { url: buildRuleCreateUrl(), label: 'the create rule wizard' };
        case 'rses':
            return { url: buildRSESearchUrl(params.expression), label: params.expression ? `the RSE list for ${params.expression}` : 'the RSE list' };
        case 'rse':
            if (!params.rse) return missing(page, ['rse']);
            return { url: buildRSEDetailUrl(params.rse), label: `RSE ${params.rse}` };
        case 'subscriptions':
            return { url: buildSubscriptionSearchUrl(params.account), label: 'the subscription list' };
        case 'subscription':
            if (!params.account || !params.name) return missing(page, ['account', 'name']);
            return { url: buildSubscriptionDetailUrl(params.account, params.name), label: `subscription ${params.account}:${params.name}` };
        case 'accounts':
            return { url: buildAccountsListUrl(), label: 'the account list' };
        case 'account':
            if (!params.account) return missing(page, ['account']);
            return { url: buildAccountDetailUrl(params.account, params.tab), label: `account ${params.account}` };
        case 'assistant_settings':
            return { url: buildAssistantSettingsUrl(), label: 'the Rucio bot settings' };
        default: {
            const unknownPage: never = page;
            return toolError('invalid_args', `Unknown page ${String(unknownPage)}.`);
        }
    }
}

function capitalise(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Resolves a navigate call to a URL, or a ToolError when params are missing, the page is off or not allowed. */
export function resolveNavigateTarget(input: NavigateInput, env: NavigateEnv): NavigateTarget | ToolError {
    const params = input.params ?? {};
    const built = build(input.page, params);
    if (isToolError(built)) return built;

    const flag = PAGE_FLAGS[input.page];
    if (flag && !env.flags?.[flag]) return toolError('unavailable', `${capitalise(built.label)} is turned off on this server.`);
    if (input.page === 'accounts' && env.role !== Role.ADMIN) return toolError('forbidden', 'Only admins can open the account list.');
    if (input.page === 'account' && env.role !== Role.ADMIN && params.account !== env.account) {
        return toolError('forbidden', 'Only admins can open the page of another account.');
    }

    return { url: built.url, pathname: built.url.split('?')[0], label: built.label, actionPrefix: ACTION_PREFIX[input.page] };
}

/** One-line label of a navigate call, used by describeCall. */
export function navigateLabel(input: NavigateInput): string {
    const built = build(input.page, input.params ?? {});
    return isToolError(built) ? input.page : built.label;
}
