/**
 * Rucio transfer request states (lib/rucio/db/sqla/constants.py RequestState).
 * The REST API takes the one letter codes in `request_states` and returns the names.
 */
export const REQUEST_STATES = [
    'QUEUED',
    'SUBMITTING',
    'SUBMITTED',
    'FAILED',
    'DONE',
    'LOST',
    'NO_SOURCES',
    'ONLY_TAPE_SOURCES',
    'SUBMISSION_FAILED',
    'MISMATCH_SCHEME',
    'SUSPEND',
    'WAITING',
    'PREPARING',
] as const;

export type RequestState = (typeof REQUEST_STATES)[number];

export const REQUEST_STATE_CODES: Record<RequestState, string> = {
    QUEUED: 'Q',
    SUBMITTING: 'G',
    SUBMITTED: 'S',
    FAILED: 'F',
    DONE: 'D',
    LOST: 'L',
    NO_SOURCES: 'N',
    ONLY_TAPE_SOURCES: 'O',
    SUBMISSION_FAILED: 'A',
    MISMATCH_SCHEME: 'M',
    SUSPEND: 'U',
    WAITING: 'W',
    PREPARING: 'P',
};

/** Requests still on their way. Default for "what is in transfer". */
export const ACTIVE_REQUEST_STATES: readonly RequestState[] = ['QUEUED', 'SUBMITTING', 'SUBMITTED', 'WAITING', 'PREPARING'];

const MAX_ACTIVITY_LENGTH = 50; // Rucio column size of requests.activity

export const isRequestState = (value: unknown): value is RequestState =>
    typeof value === 'string' && (REQUEST_STATES as readonly string[]).includes(value);

/** One row of GET /requests/list, flattened for tables and the SQL scratchpad. Times are ISO 8601 UTC or null. */
export interface TransferRequest {
    id: string;
    requestType: string;
    scope: string;
    name: string;
    didType: string;
    state: RequestState | 'UNKNOWN';
    activity: string | null;
    bytes: number | null;
    sourceRse: string | null;
    destRse: string;
    account: string | null;
    ruleId: string | null;
    retryCount: number;
    priority: number | null;
    transfertool: string | null;
    externalHost: string | null;
    externalId: string | null;
    errMsg: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    requestedAt: string | null;
    submittedAt: string | null;
    startedAt: string | null;
    transferredAt: string | null;
}

/** Filter of the list-requests use case: an RSE pair or a site pair, optional states and activity. */
export interface RequestListFilter {
    srcRse?: string;
    dstRse?: string;
    srcSite?: string;
    dstSite?: string;
    requestStates?: RequestState[];
    activity?: string;
}

/** The link sent to Rucio. Sites resolve through the RSE attribute "site". */
export type RequestLink = { kind: 'rse' | 'site'; src: string; dst: string };

/** User facing message when the filter cannot be sent to Rucio, else undefined. */
export function validateRequestListFilter(filter: RequestListFilter): string | undefined {
    const anyRse = Boolean(filter.srcRse || filter.dstRse);
    const anySite = Boolean(filter.srcSite || filter.dstSite);
    if (anyRse && anySite) return 'Give either src_rse and dst_rse, or src_site and dst_site, not both.';
    if (!anyRse && !anySite) return 'Give a source and a destination: src_rse and dst_rse, or src_site and dst_site.';
    if (anyRse && !(filter.srcRse && filter.dstRse)) return 'Give both src_rse and dst_rse.';
    if (anySite && !(filter.srcSite && filter.dstSite)) return 'Give both src_site and dst_site.';
    const unknownState = (filter.requestStates ?? []).find(state => !isRequestState(state));
    if (unknownState !== undefined) return `Unknown request state: ${unknownState}.`;
    if (filter.activity !== undefined && (filter.activity.length === 0 || filter.activity.length > MAX_ACTIVITY_LENGTH)) {
        return 'activity must be 1 to 50 characters.';
    }
    return undefined;
}

export function toRequestLink(filter: RequestListFilter): RequestLink | undefined {
    if (filter.srcRse && filter.dstRse) return { kind: 'rse', src: filter.srcRse, dst: filter.dstRse };
    if (filter.srcSite && filter.dstSite) return { kind: 'site', src: filter.srcSite, dst: filter.dstSite };
    return undefined;
}

/** The states to ask Rucio for: the given ones without duplicates, or the active states. */
export function resolveRequestStates(states: RequestState[] | undefined): RequestState[] {
    return states && states.length > 0 ? Array.from(new Set(states)) : [...ACTIVE_REQUEST_STATES];
}
