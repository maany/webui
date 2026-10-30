import { z } from 'zod';
import { DIDType, RuleState } from '@/lib/core/entity/rucio';
import { formatDateForUrl, RuleSearchFilters } from '@/lib/infrastructure/utils/navigation';

/** Parses YYYY-MM-DD as a local date, so formatDateForUrl gives back the same day in every time zone. */
export function parseLocalDate(value: string): Date {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
}

export const DATE_PARAM = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
    .refine(value => formatDateForUrl(parseLocalDate(value)) === value, 'Not a real calendar date.');

export const DID_TYPE_NAMES = ['all', 'dataset', 'container', 'file'] as const;
export type DIDTypeName = (typeof DID_TYPE_NAMES)[number];

const DID_TYPE_BY_NAME: Record<DIDTypeName, DIDType> = {
    all: DIDType.ALL,
    dataset: DIDType.DATASET,
    container: DIDType.CONTAINER,
    file: DIDType.FILE,
};

export function didTypeFromName(name: DIDTypeName | undefined): DIDType {
    return DID_TYPE_BY_NAME[name ?? 'all'];
}

export interface RuleFilterParams {
    account?: string;
    scope?: string;
    name?: string;
    activity?: string;
    state?: RuleState;
    updatedAfter?: string;
    updatedBefore?: string;
}

/** Rule list filters for buildRuleSearchUrl; dates are YYYY-MM-DD strings validated by DATE_PARAM. */
export function ruleSearchFilters(params: RuleFilterParams): RuleSearchFilters {
    return {
        account: params.account,
        scope: params.scope,
        name: params.name,
        activity: params.activity,
        state: params.state,
        updatedAfter: params.updatedAfter ? parseLocalDate(params.updatedAfter) : undefined,
        updatedBefore: params.updatedBefore ? parseLocalDate(params.updatedBefore) : undefined,
    };
}
