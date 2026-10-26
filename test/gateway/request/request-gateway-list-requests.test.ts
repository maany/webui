import { TransferRequestDTO } from '@/lib/core/dto/request-dto';
import RequestGatewayOutputPort from '@/lib/core/port/secondary/request-gateway-output-port';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import GATEWAYS from '@/lib/infrastructure/ioc/ioc-symbols-gateway';
import MockRucioServerFactory, { MockEndpoint } from 'test/fixtures/rucio-server';
import { collectStreamedData } from 'test/fixtures/stream-test-utils';
import { expectedTransferRequest, rucioRequestRow, toNDJSON } from 'test/fixtures/request-fixtures';

const TOKEN = MockRucioServerFactory.VALID_RUCIO_TOKEN;
const RSE_LINK = { kind: 'rse' as const, src: 'CERN-PROD_DATADISK', dst: 'BNL-OSG2_DATADISK' };

const endpoint = (
    status: number,
    body: string,
    requestValidator?: (req: Request) => Promise<boolean>,
    contentType = 'application/x-json-stream',
): MockEndpoint => ({
    url: `${MockRucioServerFactory.RUCIO_HOST}/requests/list`,
    method: 'GET',
    includes: '/requests/list',
    requestValidator,
    response: { status, headers: { 'Content-Type': contentType }, body },
});

describe('Request Gateway: List Requests', () => {
    const gateway = () => appContainer.get<RequestGatewayOutputPort>(GATEWAYS.REQUEST);
    beforeEach(() => fetchMock.doMock());
    afterEach(() => fetchMock.dontMock());

    it('streams requests with state names, RSE names and ISO times', async () => {
        MockRucioServerFactory.createMockRucioServer(true, [
            endpoint(
                200,
                toNDJSON([
                    rucioRequestRow(),
                    rucioRequestRow({ id: 'second', state: 'QUEUED', source_rse: null, source_rse_id: null, bytes: null, submitted_at: null }),
                ]),
            ),
        ]);
        const dto = await gateway().listRequests(TOKEN, RSE_LINK, ['QUEUED', 'SUBMITTED']);
        expect(dto.status).toBe('success');
        const rows = await collectStreamedData<TransferRequestDTO>(dto.stream);
        expect(rows).toEqual([
            { status: 'success', ...expectedTransferRequest() },
            { status: 'success', ...expectedTransferRequest({ id: 'second', state: 'QUEUED', sourceRse: null, bytes: null, submittedAt: null }) },
        ]);
    });

    it('maps a state name it does not know to UNKNOWN', async () => {
        MockRucioServerFactory.createMockRucioServer(true, [endpoint(200, toNDJSON([rucioRequestRow({ state: 'SOMETHING_NEW' })]))]);
        const dto = await gateway().listRequests(TOKEN, RSE_LINK, ['QUEUED']);
        const rows = await collectStreamedData<TransferRequestDTO>(dto.stream);
        expect(rows[0].state).toBe('UNKNOWN');
    });

    it('sends the RSE pair, the one letter state codes and the NDJSON accept header', async () => {
        let seen: URLSearchParams | undefined;
        let accept: string | null = null;
        MockRucioServerFactory.createMockRucioServer(true, [
            endpoint(200, '', async req => {
                seen = new URL(req.url).searchParams;
                accept = req.headers.get('Accept');
                return true;
            }),
        ]);
        const dto = await gateway().listRequests(TOKEN, RSE_LINK, ['QUEUED', 'SUBMITTING', 'SUBMITTED', 'WAITING', 'PREPARING']);
        await collectStreamedData(dto.stream);
        expect(seen?.get('src_rse')).toBe('CERN-PROD_DATADISK');
        expect(seen?.get('dst_rse')).toBe('BNL-OSG2_DATADISK');
        expect(seen?.get('request_states')).toBe('Q,G,S,W,P');
        expect(seen?.has('src_site')).toBe(false);
        expect(seen?.has('activity')).toBe(false);
        expect(accept).toBe('application/x-json-stream');
    });

    it('sends a site pair instead of RSEs', async () => {
        let seen: URLSearchParams | undefined;
        MockRucioServerFactory.createMockRucioServer(true, [
            endpoint(200, '', async req => {
                seen = new URL(req.url).searchParams;
                return true;
            }),
        ]);
        const dto = await gateway().listRequests(TOKEN, { kind: 'site', src: 'CERN-PROD', dst: 'BNL-ATLAS' }, ['DONE', 'FAILED']);
        await collectStreamedData(dto.stream);
        expect(seen?.get('src_site')).toBe('CERN-PROD');
        expect(seen?.get('dst_site')).toBe('BNL-ATLAS');
        expect(seen?.get('request_states')).toBe('D,F');
        expect(seen?.has('src_rse')).toBe(false);
        expect(seen?.has('dst_rse')).toBe(false);
    });

    it('yields an empty stream for an empty body', async () => {
        MockRucioServerFactory.createMockRucioServer(true, [endpoint(200, '')]);
        const dto = await gateway().listRequests(TOKEN, RSE_LINK, ['QUEUED']);
        expect(dto.status).toBe('success');
        expect(await collectStreamedData(dto.stream)).toEqual([]);
    });

    it('reports AccessDenied, which Rucio sends as HTTP 500', async () => {
        MockRucioServerFactory.createMockRucioServer(true, [
            endpoint(
                500,
                JSON.stringify({ ExceptionClass: 'AccessDenied', ExceptionMessage: "jdoe cannot list requests from RSEs ['A'] to RSEs ['B']." }),
                undefined,
                'application/octet-stream',
            ),
        ]);
        expect(await gateway().listRequests(TOKEN, RSE_LINK, ['QUEUED'])).toMatchObject({
            status: 'error',
            errorCode: 500,
            errorClass: 'AccessDenied',
            errorType: 'gateway_endpoint_error',
        });
    });

    it('reports RSENotFound for an unknown RSE', async () => {
        MockRucioServerFactory.createMockRucioServer(true, [
            endpoint(
                500,
                JSON.stringify({ ExceptionClass: 'RSENotFound', ExceptionMessage: 'RSE does not exist.' }),
                undefined,
                'application/octet-stream',
            ),
        ]);
        expect(await gateway().listRequests(TOKEN, RSE_LINK, ['QUEUED'])).toMatchObject({
            status: 'error',
            errorCode: 500,
            errorClass: 'RSENotFound',
        });
    });
});
