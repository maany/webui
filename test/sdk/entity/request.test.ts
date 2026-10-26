import {
    ACTIVE_REQUEST_STATES,
    REQUEST_STATE_CODES,
    REQUEST_STATES,
    RequestListFilter,
    isRequestState,
    resolveRequestStates,
    toRequestLink,
    validateRequestListFilter,
} from '@/lib/core/entity/request';

describe('request states', () => {
    it('mirrors the Rucio RequestState enum, name to one letter code', () => {
        expect(REQUEST_STATE_CODES).toEqual({
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
        });
        expect(Object.keys(REQUEST_STATE_CODES)).toEqual([...REQUEST_STATES]);
    });

    it('treats queued, submitting, submitted, waiting and preparing as active', () => {
        expect([...ACTIVE_REQUEST_STATES]).toEqual(['QUEUED', 'SUBMITTING', 'SUBMITTED', 'WAITING', 'PREPARING']);
    });

    it('recognises state names only', () => {
        expect(isRequestState('DONE')).toBe(true);
        expect(isRequestState('D')).toBe(false);
        expect(isRequestState(undefined)).toBe(false);
    });
});

describe('resolveRequestStates', () => {
    it('falls back to the active states', () => {
        expect(resolveRequestStates(undefined)).toEqual([...ACTIVE_REQUEST_STATES]);
        expect(resolveRequestStates([])).toEqual([...ACTIVE_REQUEST_STATES]);
    });

    it('keeps the given order and drops duplicates', () => {
        expect(resolveRequestStates(['FAILED', 'DONE', 'FAILED'])).toEqual(['FAILED', 'DONE']);
    });
});

describe('validateRequestListFilter', () => {
    const cases: [RequestListFilter, string | undefined][] = [
        [{ srcRse: 'A', dstRse: 'B' }, undefined],
        [{ srcSite: 'S1', dstSite: 'S2', requestStates: ['DONE'] }, undefined],
        [{ srcRse: 'A', dstRse: 'B', activity: 'User Subscriptions' }, undefined],
        [{}, 'Give a source and a destination: src_rse and dst_rse, or src_site and dst_site.'],
        [{ srcRse: 'A' }, 'Give both src_rse and dst_rse.'],
        [{ dstRse: 'B' }, 'Give both src_rse and dst_rse.'],
        [{ srcSite: 'S1' }, 'Give both src_site and dst_site.'],
        [{ srcRse: 'A', dstRse: 'B', srcSite: 'S1' }, 'Give either src_rse and dst_rse, or src_site and dst_site, not both.'],
        [{ srcRse: 'A', dstRse: 'B', requestStates: ['BOGUS' as never] }, 'Unknown request state: BOGUS.'],
        [{ srcRse: 'A', dstRse: 'B', activity: 'x'.repeat(51) }, 'activity must be 1 to 50 characters.'],
    ];

    it.each(cases)('%j -> %s', (filter, expected) => {
        expect(validateRequestListFilter(filter)).toBe(expected);
    });
});

describe('toRequestLink', () => {
    it('builds an RSE link', () => {
        expect(toRequestLink({ srcRse: 'A', dstRse: 'B' })).toEqual({ kind: 'rse', src: 'A', dst: 'B' });
    });

    it('builds a site link', () => {
        expect(toRequestLink({ srcSite: 'CERN-PROD', dstSite: 'BNL-ATLAS' })).toEqual({ kind: 'site', src: 'CERN-PROD', dst: 'BNL-ATLAS' });
    });

    it('returns undefined for half a pair', () => {
        expect(toRequestLink({ srcRse: 'A' })).toBeUndefined();
    });
});
