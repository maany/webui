import { NextRequest } from 'next/server';

// jsdom doesn't ship Response.json, which NextResponse.json relies on.
if (typeof (global.Response as { json?: unknown }).json !== 'function') {
    (global.Response as unknown as { json: (data: unknown, init?: ResponseInit) => Response }).json = (data, init) =>
        new Response(JSON.stringify(data), { ...init, headers: { 'content-type': 'application/json' } });
}

import FeatureConfigGateway from '@/lib/infrastructure/gateway/feature-config-gateway';

// The flag guard and the query parsing are real; only the controller execution is stubbed.
const mockExecute = jest.fn(async (..._args: unknown[]) => new Response('', { status: 200 }));
jest.mock('@/lib/infrastructure/adapters/app-router-controller-adapter', () => {
    const actual = jest.requireActual('@/lib/infrastructure/adapters/app-router-controller-adapter');
    return { __esModule: true, ...actual, executeAuthenticatedController: (...args: unknown[]) => mockExecute(...args) };
});

import { GET } from '@/app/api/feature/list-requests/route';

const req = (query: string) => new NextRequest(`http://localhost/api/feature/list-requests${query}`);
const filterOf = (callIndex = 0) => (mockExecute.mock.calls[callIndex][1] as { filter: Record<string, unknown> }).filter;

describe('GET /api/feature/list-requests', () => {
    let isAnyEnabled: jest.SpyInstance;

    beforeEach(() => {
        mockExecute.mockClear();
        isAnyEnabled = jest.spyOn(FeatureConfigGateway.prototype, 'isAnyEnabled').mockResolvedValue(true);
    });

    afterEach(() => {
        isAnyEnabled.mockRestore();
    });

    it('returns 404 when the requests flag is off', async () => {
        isAnyEnabled.mockResolvedValue(false);
        const res = await GET(req('?src_rse=A&dst_rse=B'));
        expect(res.status).toBe(404);
        expect(isAnyEnabled).toHaveBeenCalledWith(['requests']);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it('streams through the controller with comma separated states', async () => {
        const res = await GET(
            req('?src_rse=CERN-PROD_DATADISK&dst_rse=BNL-OSG2_DATADISK&request_states=QUEUED,SUBMITTED&activity=User%20Subscriptions'),
        );
        expect(res.status).toBe(200);
        expect(mockExecute).toHaveBeenCalledTimes(1);
        expect(mockExecute.mock.calls[0][2]).toBe(true);
        expect(filterOf()).toEqual({
            srcRse: 'CERN-PROD_DATADISK',
            dstRse: 'BNL-OSG2_DATADISK',
            requestStates: ['QUEUED', 'SUBMITTED'],
            activity: 'User Subscriptions',
        });
    });

    it('accepts repeated request_states keys and a site pair', async () => {
        await GET(req('?src_site=CERN-PROD&dst_site=BNL-ATLAS&request_states=QUEUED&request_states=WAITING'));
        expect(filterOf()).toEqual({ srcSite: 'CERN-PROD', dstSite: 'BNL-ATLAS', requestStates: ['QUEUED', 'WAITING'] });
    });

    it('leaves request_states unset so the use case applies the active states', async () => {
        await GET(req('?src_rse=A&dst_rse=B'));
        expect(filterOf().requestStates).toBeUndefined();
    });

    it.each(['?src_rse=A&dst_rse=B&request_states=QUEUED,BOGUS', `?src_rse=A&dst_rse=B&activity=${'x'.repeat(51)}`])(
        'returns 400 for %s',
        async query => {
            const res = await GET(req(query));
            expect(res.status).toBe(400);
            await expect(res.json()).resolves.toMatchObject({ status: 'error', errorType: 'validation_error' });
            expect(mockExecute).not.toHaveBeenCalled();
        },
    );
});
