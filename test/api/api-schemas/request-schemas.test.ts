import { ListRequestsSchema } from '@/lib/infrastructure/api-schemas/list-requests';
import { parseQuery } from '@/lib/infrastructure/api-schemas/parse';

describe('ListRequestsSchema', () => {
    it('accepts an RSE pair with states and an activity', () => {
        const result = ListRequestsSchema.safeParse({
            src_rse: 'CERN-PROD_DATADISK',
            dst_rse: 'BNL-OSG2_DATADISK',
            request_states: ['QUEUED', 'SUBMITTED'],
            activity: 'User Subscriptions',
        });
        expect(result.success).toBe(true);
    });

    it('accepts an empty query; the use case checks the pairing', () => {
        expect(ListRequestsSchema.safeParse({}).success).toBe(true);
    });

    const invalid: Record<string, unknown>[] = [
        { request_states: ['BOGUS'] },
        { request_states: [] },
        { request_states: ['Q'] },
        { activity: 'x'.repeat(51) },
        { src_rse: '' },
    ];

    it.each(invalid)('rejects %j', input => {
        expect(ListRequestsSchema.safeParse(input).success).toBe(false);
    });
});

describe('parseQuery(ListRequestsSchema)', () => {
    it('reads repeated request_states keys as a list', () => {
        const result = parseQuery(ListRequestsSchema, new URLSearchParams('src_rse=A&dst_rse=B&request_states=QUEUED&request_states=SUBMITTED'));
        expect(result.success).toBe(true);
        expect(result.success && result.data).toEqual({ src_rse: 'A', dst_rse: 'B', request_states: ['QUEUED', 'SUBMITTED'] });
    });

    it('reads a single request_states key as a one item list', () => {
        const result = parseQuery(ListRequestsSchema, new URLSearchParams('src_site=CERN-PROD&dst_site=BNL-ATLAS&request_states=DONE'));
        expect(result.success && result.data).toEqual({ src_site: 'CERN-PROD', dst_site: 'BNL-ATLAS', request_states: ['DONE'] });
    });

    it('fails on an unknown state', () => {
        expect(parseQuery(ListRequestsSchema, new URLSearchParams('src_rse=A&dst_rse=B&request_states=BOGUS')).success).toBe(false);
    });
});
