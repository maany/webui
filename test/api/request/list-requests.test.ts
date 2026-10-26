import { NextApiResponse } from 'next';
import appContainer, { CONTROLLER_FLAG_MAP } from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import { BaseController } from '@/lib/sdk/controller';
import { RequestListFilter } from '@/lib/core/entity/request';
import { ListRequestsRequest } from '@/lib/core/usecase-models/list-requests-usecase-models';
import { ListRequestsControllerParameters } from '@/lib/infrastructure/controller/list-requests-controller';
import { TransferRequestViewModel } from '@/lib/infrastructure/data/view-model/request';
import { MockHttpStreamableResponseFactory } from 'test/fixtures/http-fixtures';
import MockRucioServerFactory, { MockEndpoint } from 'test/fixtures/rucio-server';
import { expectedTransferRequest, rucioRequestRow, toNDJSON } from 'test/fixtures/request-fixtures';

function collect(res: ReturnType<typeof MockHttpStreamableResponseFactory.getMockResponse>): Promise<TransferRequestViewModel[]> {
    const received: TransferRequestViewModel[] = [];
    const onData = (data: string) => received.push(JSON.parse(data));
    return new Promise((resolve, reject) => {
        res.on('data', onData);
        res.on('end', () => {
            res.off('data', onData);
            resolve(received);
        });
        res.on('error', (err: Error) => {
            res.off('data', onData);
            reject(err);
        });
    });
}

const listEndpoint = (
    status: number,
    body: string,
    headers: Record<string, string> = { 'Content-Type': 'application/x-json-stream' },
): MockEndpoint => ({
    url: `${MockRucioServerFactory.RUCIO_HOST}/requests/list`,
    method: 'GET',
    includes: '/requests/list',
    response: { status, headers, body },
});

const requestedListURL = (): URL | undefined => {
    const url = fetchMock.mock.calls.map(call => String(call[0])).find(called => called.includes('/requests/list'));
    return url ? new URL(url) : undefined;
};

describe('Feature: ListRequests', () => {
    beforeEach(() => {
        fetchMock.doMock();
    });

    afterEach(() => {
        fetchMock.resetMocks();
    });

    const run = async (filter: RequestListFilter) => {
        const res = MockHttpStreamableResponseFactory.getMockResponse();
        const controller = appContainer.get<BaseController<ListRequestsControllerParameters, ListRequestsRequest>>(CONTROLLERS.LIST_REQUESTS);
        await controller.execute({
            rucioAuthToken: MockRucioServerFactory.VALID_RUCIO_TOKEN,
            response: res as unknown as NextApiResponse,
            filter,
        });
        return res;
    };

    it('is gated by the requests flag', () => {
        expect(CONTROLLER_FLAG_MAP.get(CONTROLLERS.LIST_REQUESTS)).toEqual(['requests']);
    });

    it('streams the active requests of a link and drops other activities', async () => {
        MockRucioServerFactory.createMockRucioServer(true, [
            listEndpoint(200, toNDJSON([rucioRequestRow(), rucioRequestRow({ id: 'production-1', activity: 'Production' })])),
        ]);
        const res = await run({ srcRse: 'CERN-PROD_DATADISK', dstRse: 'BNL-OSG2_DATADISK', activity: 'User Subscriptions' });
        const rows = await collect(res);
        expect(rows).toEqual([{ status: 'success', ...expectedTransferRequest() }]);
        const url = requestedListURL();
        expect(url?.searchParams.get('request_states')).toBe('Q,G,S,W,P');
        expect(url?.searchParams.has('activity')).toBe(false);
    });

    it('answers 403 permission_denied when Rucio refuses a non admin (AccessDenied as HTTP 500)', async () => {
        MockRucioServerFactory.createMockRucioServer(true, [
            listEndpoint(
                500,
                JSON.stringify({ ExceptionClass: 'AccessDenied', ExceptionMessage: "jdoe cannot list requests from RSEs ['A'] to RSEs ['B']." }),
                {
                    'Content-Type': 'application/octet-stream',
                    ExceptionClass: 'AccessDenied',
                },
            ),
        ]);
        const res = await run({ srcRse: 'A', dstRse: 'B' });
        expect(res._getStatusCode()).toBe(403);
        expect(await res._getJSONData()).toMatchObject({
            status: 'error',
            errorType: 'permission_denied',
            message: 'Only Rucio admins can list transfer requests on this server.',
        });
    });

    it('answers 404 not_found for an unknown RSE (RSENotFound as HTTP 500)', async () => {
        MockRucioServerFactory.createMockRucioServer(true, [
            listEndpoint(500, JSON.stringify({ ExceptionClass: 'RSENotFound', ExceptionMessage: 'RSE does not exist.' }), {
                'Content-Type': 'application/octet-stream',
            }),
        ]);
        const res = await run({ srcRse: 'NOPE', dstRse: 'B' });
        expect(res._getStatusCode()).toBe(404);
        expect(await res._getJSONData()).toMatchObject({ status: 'error', errorType: 'not_found' });
    });

    it('answers 400 validation_error without calling Rucio for half a pair', async () => {
        MockRucioServerFactory.createMockRucioServer(true, []);
        const res = await run({ srcRse: 'A' });
        expect(res._getStatusCode()).toBe(400);
        expect(await res._getJSONData()).toMatchObject({ status: 'error', errorType: 'validation_error', message: 'Give both src_rse and dst_rse.' });
        expect(requestedListURL()).toBeUndefined();
    });
});
