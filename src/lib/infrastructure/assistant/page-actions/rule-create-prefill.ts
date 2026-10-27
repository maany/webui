import { z } from 'zod';
import { DIDType } from '@/lib/core/entity/rucio';
import { CreateRuleGrouping, CreateRuleParameters, getEmptyCreateRuleParameters } from '@/lib/infrastructure/data/view-model/rule';
import { ListDIDsViewModel } from '@/lib/infrastructure/data/view-model/list-did';
import { RSEAccountUsageLimitViewModel } from '@/lib/infrastructure/data/view-model/rse';
import {
    computeNeedsApproval,
    computeOptionsErrors,
    CreateRuleOptionsErrors,
    getTotalDataSize,
    hasOptionsErrors,
} from '@/component-library/pages/Rule/create/create-rule-validation';
import { isToolError, toolError } from '@/lib/infrastructure/assistant/page-tool-errors';
import { fetchNdjsonRows } from './fetch-ndjson';

export const RULE_CREATE_PREFILL_ACTION = 'rule_create.prefill';
export const RULE_CREATE_PREFILL_DESCRIPTION =
    'Fill the create rule wizard with DIDs, the RSEs of an RSE expression and the rule options. ' +
    'The wizard then shows the step that needs the user; the user reviews and submits.';

export const MAX_PREFILL_DIDS = 20;
export const MAX_PREFILL_RSES = 50;

export const RULE_CREATE_STEPS = { DIDS: 0, RSES: 1, OPTIONS: 2, SUMMARY: 3 } as const;

const GROUPING: Record<'all' | 'dataset' | 'none', CreateRuleGrouping> = {
    all: CreateRuleGrouping.ALL,
    dataset: CreateRuleGrouping.DATASET,
    none: CreateRuleGrouping.NONE,
};

const DID_STRING = z.string().regex(/^[^:\s*?]+:[^\s*?]+$/, 'Use scope:name without wildcards.');

export const RuleCreatePrefillSchema = z.object({
    dids: z.array(DID_STRING).min(1).max(MAX_PREFILL_DIDS).describe('DIDs as scope:name, no wildcards'),
    rseExpression: z.string().min(1).max(500).describe('RSE expression, for example tier=1&type=DISK'),
    rses: z
        .array(z.string().min(1))
        .min(1)
        .max(MAX_PREFILL_RSES)
        .optional()
        .describe('RSE names to select from the expression. Default: every RSE it matches'),
    copies: z.number().int().min(1).optional().describe('Number of copies, default 1'),
    lifetimeDays: z.number().int().min(1).optional().describe('Rule lifetime in days; leave out for no expiry'),
    grouping: z.enum(['all', 'dataset', 'none']).optional(),
    asynchronous: z.boolean().optional(),
    notify: z.boolean().optional(),
    askApproval: z.boolean().optional().describe('Ask for approval, needed when no RSE has enough quota'),
    comments: z.string().max(500).optional().describe('Comment; required when askApproval is true'),
    sampleFileCount: z.number().int().min(1).optional().describe('Only replicate this many random files'),
});
export type RuleCreatePrefillArgs = z.infer<typeof RuleCreatePrefillSchema>;

export interface RuleCreatePrefillResult {
    parameters: CreateRuleParameters;
    activeIndex: number;
    summary: string;
}

const BYTE_UNITS = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'];

export function formatBytes(bytes: number): string {
    let value = bytes;
    let unit = 0;
    while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
        value /= 1000;
        unit += 1;
    }
    return `${unit === 0 ? value : value.toFixed(1)} ${BYTE_UNITS[unit]}`;
}

const OPTION_ERROR_TEXT: Record<keyof CreateRuleOptionsErrors, string> = {
    tooManyCopies: 'fewer RSEs have enough quota than the number of copies',
    copiesInvalid: 'copies must be between 1 and the number of RSEs',
    lifetimeInvalid: 'the lifetime must be at least 1 day',
    commentsEmpty: 'a comment is required when asking for approval',
    groupingInvalid: 'the grouping is not valid',
    sampleCountInvalid: 'the sample file count must be at least 1',
};

function plural(count: number, one: string, many: string): string {
    return `${count} ${count === 1 ? one : many}`;
}

async function fetchDID(did: string, signal?: AbortSignal): Promise<ListDIDsViewModel> {
    const separator = did.indexOf(':');
    const scope = did.slice(0, separator);
    const name = did.slice(separator + 1);
    const query = new URLSearchParams({ query: `${scope}:${name}`, type: DIDType.ALL });
    let rows: ListDIDsViewModel[];
    try {
        rows = await fetchNdjsonRows<ListDIDsViewModel>(`/api/feature/list-dids?${query.toString()}`, { signal });
    } catch (thrown) {
        if (isToolError(thrown) && thrown.error === 'not_found') throw toolError('not_found', `DID ${did} was not found.`);
        throw thrown;
    }
    const match = rows.find(row => (row.kind ?? 'did') === 'did' && row.status === 'success' && row.scope === scope && row.name === name);
    if (!match) throw toolError('not_found', `DID ${did} was not found.`);
    return match;
}

async function fetchQuotas(rseExpression: string, dids: ListDIDsViewModel[], signal?: AbortSignal): Promise<RSEAccountUsageLimitViewModel[]> {
    let rows: RSEAccountUsageLimitViewModel[];
    try {
        rows = await fetchNdjsonRows<RSEAccountUsageLimitViewModel>('/api/feature/list-account-rse-quotas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rseExpression, requestedDIDs: dids }),
            signal,
        });
    } catch (thrown) {
        if (isToolError(thrown) && thrown.error === 'not_found') return [];
        throw thrown;
    }
    return rows.filter(row => row.status === 'success');
}

function selectRSEs(available: RSEAccountUsageLimitViewModel[], args: RuleCreatePrefillArgs): RSEAccountUsageLimitViewModel[] {
    if (args.rses) {
        const missing = args.rses.filter(name => !available.some(rse => rse.rse === name));
        if (missing.length > 0) {
            throw toolError('not_found', `"${args.rseExpression}" does not give quota information for: ${missing.join(', ')}.`);
        }
        return available.filter(rse => args.rses!.includes(rse.rse));
    }
    if (available.length === 0) throw toolError('not_found', `"${args.rseExpression}" matched no RSEs.`);
    if (available.length > MAX_PREFILL_RSES) {
        throw toolError(
            'invalid_args',
            `"${args.rseExpression}" matches ${available.length} RSEs. Pass rses with at most ${MAX_PREFILL_RSES} names.`,
        );
    }
    return available;
}

function chooseStep(parameters: CreateRuleParameters): number {
    if (parameters.needsApproval && !parameters.askApproval) return RULE_CREATE_STEPS.RSES;
    if (hasOptionsErrors(computeOptionsErrors(parameters))) return RULE_CREATE_STEPS.OPTIONS;
    return RULE_CREATE_STEPS.SUMMARY;
}

function describePrefill(parameters: CreateRuleParameters, step: number): string {
    const shown = parameters.rses.slice(0, 5).map(rse => rse.rse);
    const more = parameters.rses.length > 5 ? ` and ${parameters.rses.length - 5} more` : '';
    const base =
        `Filled the create rule wizard with ${plural(parameters.dids.length, 'DID', 'DIDs')} (${formatBytes(getTotalDataSize(parameters))}), ` +
        `${plural(parameters.rses.length, 'RSE', 'RSEs')} (${shown.join(', ')}${more}) from "${parameters.rseExpression}" ` +
        `and ${plural(parameters.copies, 'copy', 'copies')}.`;
    if (step === RULE_CREATE_STEPS.RSES) {
        return `${base} It shows the RSEs step: no chosen RSE has enough quota, so the user must tick "Ask for approval" or pick other RSEs.`;
    }
    if (step === RULE_CREATE_STEPS.OPTIONS) {
        const errors = computeOptionsErrors(parameters);
        const reasons = (Object.keys(errors) as (keyof CreateRuleOptionsErrors)[]).filter(key => errors[key]).map(key => OPTION_ERROR_TEXT[key]);
        return `${base} It shows the Options step because ${reasons.join('; ')}. The user fixes this, then submits.`;
    }
    return `${base} It shows the Summary step. The user reviews it and presses Submit.`;
}

/** Fetches what the wizard stores (full view models with sizes and quotas) and builds its state. */
export async function resolveRuleCreatePrefill(args: RuleCreatePrefillArgs, signal?: AbortSignal): Promise<RuleCreatePrefillResult> {
    const dids: ListDIDsViewModel[] = [];
    for (const did of [...new Set(args.dids)]) {
        dids.push(await fetchDID(did, signal));
    }

    const rses = selectRSEs(await fetchQuotas(args.rseExpression, dids, signal), args);

    const parameters: CreateRuleParameters = {
        ...getEmptyCreateRuleParameters(),
        dids,
        rses,
        rseExpression: args.rseExpression,
        copies: args.copies ?? 1,
        daysLifetime: args.lifetimeDays,
        grouping: args.grouping ? GROUPING[args.grouping] : undefined,
        asynchronous: args.asynchronous ?? false,
        notify: args.notify ?? false,
        sample: args.sampleFileCount !== undefined,
        sampleFileCount: args.sampleFileCount,
        comments: args.comments,
        askApproval: args.askApproval ?? false,
        needsApproval: computeNeedsApproval(rses, getTotalDataSize({ dids })),
    };

    const activeIndex = chooseStep(parameters);
    return { parameters, activeIndex, summary: describePrefill(parameters, activeIndex) };
}
