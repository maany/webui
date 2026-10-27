import { z } from 'zod';
import { DIDType, RuleState } from '@/lib/core/entity/rucio';
import { ACCOUNT_NAME_PATTERN_REGEX, isValidAccountName } from '@/lib/core/utils/account-validation';
import { buildDIDSearchUrl, buildRSESearchUrl, buildRuleSearchUrl, buildSubscriptionSearchUrl } from '@/lib/infrastructure/utils/navigation';
import { DATE_PARAM, DID_TYPE_NAMES, didTypeFromName, ruleSearchFilters } from '@/lib/infrastructure/assistant/page-url-params';

// dids.search

export const DIDS_SEARCH_ACTION = 'dids.search';
export const DIDS_SEARCH_DESCRIPTION =
    'Search DIDs on this page by scope and name (* wildcards allowed) and an optional type. Results stream into the table.';

const NO_COLON = z
    .string()
    .min(1)
    .max(255)
    .regex(/^[^:]+$/, 'Do not include ":".');

export const DidsSearchSchema = z.object({
    scope: NO_COLON.describe('DID scope'),
    name: NO_COLON.describe('DID name, * wildcards allowed'),
    type: z.enum(DID_TYPE_NAMES).optional().describe('all (default), dataset, container or file'),
});
export type DidsSearchArgs = z.infer<typeof DidsSearchSchema>;

export interface DidsSearchTarget {
    url: string;
    pattern: string;
    type: DIDType;
    summary: string;
}

export function didsSearchTarget(args: DidsSearchArgs): DidsSearchTarget {
    const type = didTypeFromName(args.type);
    const pattern = `${args.scope}:${args.name}`;
    return {
        url: buildDIDSearchUrl({ scope: args.scope, name: args.name, type }),
        pattern,
        type,
        summary: `Started a DID search for ${pattern} (type ${type}). Results stream into the table.`,
    };
}

// rules.filter

export const RULES_FILTER_ACTION = 'rules.filter';
export const RULES_FILTER_DESCRIPTION = 'Filter the rule list on this page and run the search. Give at least one filter; dates use YYYY-MM-DD.';

export const RulesFilterSchema = z
    .object({
        account: z
            .string()
            .regex(ACCOUNT_NAME_PATTERN_REGEX, 'Not a valid account filter (lowercase letters, digits, - _ and * wildcards).')
            .optional(),
        scope: z.string().min(1).max(255).optional(),
        name: z.string().min(1).max(255).optional().describe('DID name, * wildcards allowed'),
        activity: z.string().min(1).max(255).optional(),
        state: z.enum(RuleState).optional(),
        updatedAfter: DATE_PARAM.optional(),
        updatedBefore: DATE_PARAM.optional(),
    })
    .refine(args => Object.values(args).some(value => value !== undefined), 'Give at least one filter.');
export type RulesFilterArgs = z.infer<typeof RulesFilterSchema>;

/** Same shape and defaults as the filters /rules/page.tsx passes to ListRule. */
export interface RuleListFilters {
    account: string;
    scope: string;
    name: string;
    activity: string;
    state?: RuleState;
    updatedBefore?: Date;
    updatedAfter?: Date;
}

export interface RulesFilterTarget {
    url: string;
    filters: RuleListFilters;
    summary: string;
}

export function rulesFilterTarget(args: RulesFilterArgs): RulesFilterTarget {
    const urlFilters = ruleSearchFilters(args);
    const filters: RuleListFilters = {
        account: args.account ?? '',
        scope: args.scope ?? '*',
        name: args.name ?? '',
        activity: args.activity ?? '',
        state: args.state,
        updatedAfter: urlFilters.updatedAfter,
        updatedBefore: urlFilters.updatedBefore,
    };
    const described = Object.entries(args)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key} ${String(value)}`)
        .join(', ');
    return { url: buildRuleSearchUrl(urlFilters), filters, summary: `Searching rules with ${described}. Results stream into the table.` };
}

// rses.filter

export const RSES_FILTER_ACTION = 'rses.filter';
export const RSES_FILTER_DESCRIPTION = 'List the RSEs matching an RSE expression on this page.';

export const RsesFilterSchema = z.object({
    expression: z.string().min(1).max(1000).describe('RSE expression, for example tier=1&type=DISK, or * for all'),
});
export type RsesFilterArgs = z.infer<typeof RsesFilterSchema>;

export interface RsesFilterTarget {
    url: string;
    expression: string;
    summary: string;
}

export function rsesFilterTarget(args: RsesFilterArgs): RsesFilterTarget {
    return { url: buildRSESearchUrl(args.expression), expression: args.expression, summary: `Listing the RSEs matching ${args.expression}.` };
}

// subscriptions.filter

export const SUBSCRIPTIONS_FILTER_ACTION = 'subscriptions.filter';
export const SUBSCRIPTIONS_FILTER_DESCRIPTION = 'List the subscriptions of an account on this page.';

export const SubscriptionsFilterSchema = z.object({
    account: z.string().max(255).refine(isValidAccountName, 'Not a valid Rucio account name.').describe('Account whose subscriptions to list'),
});
export type SubscriptionsFilterArgs = z.infer<typeof SubscriptionsFilterSchema>;

export interface SubscriptionsFilterTarget {
    url: string;
    account: string;
    summary: string;
}

export function subscriptionsFilterTarget(args: SubscriptionsFilterArgs): SubscriptionsFilterTarget {
    return { url: buildSubscriptionSearchUrl(args.account), account: args.account, summary: `Listing the subscriptions of ${args.account}.` };
}
