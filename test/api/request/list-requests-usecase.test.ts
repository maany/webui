import { Readable, Writable } from 'stream';
import ListRequestsUseCase from '@/lib/core/use-case/list-requests-usecase';
import { ListRequestsDTO, TransferRequestDTO } from '@/lib/core/dto/request-dto';
import { ListRequestsError, ListRequestsRequest, ListRequestsResponse } from '@/lib/core/usecase-models/list-requests-usecase-models';
import { ListRequestsOutputPort } from '@/lib/core/port/primary/list-requests-ports';
import type RequestGatewayOutputPort from '@/lib/core/port/secondary/request-gateway-output-port';
import { AuthenticatedRequestModel } from '@/lib/sdk/usecase-models';
import { ACTIVE_REQUEST_STATES, RequestListFilter } from '@/lib/core/entity/request';
import { expectedTransferRequest } from 'test/fixtures/request-fixtures';

type Captured = { responses: ListRequestsResponse[]; errors: ListRequestsError[] };

function capturingPresenter(): { presenter: ListRequestsOutputPort; captured: Captured; done: Promise<void> } {
    const captured: Captured = { responses: [], errors: [] };
    let markDone: () => void = () => undefined;
    const done = new Promise<void>(resolve => {
        markDone = resolve;
    });
    const sink = new Writable({
        objectMode: true,
        write(chunk, _enc, cb) {
            if (chunk && chunk.status === 'error') captured.errors.push(chunk as ListRequestsError);
            else if (chunk && chunk.status === 'success') captured.responses.push(chunk as ListRequestsResponse);
            cb();
        },
    });
    sink.on('finish', () => markDone());
    const presenter = {
        setupStream(transform: NodeJS.ReadWriteStream) {
            transform.pipe(sink);
        },
        presentError(error: ListRequestsError) {
            captured.errors.push(error);
            markDone();
        },
    } as unknown as ListRequestsOutputPort;
    return { presenter, captured, done };
}

const row = (overrides: Partial<TransferRequestDTO> = {}): TransferRequestDTO => ({ status: 'success', ...expectedTransferRequest(), ...overrides });

function gatewayReturning(dto: ListRequestsDTO) {
    const listRequests = jest.fn(async () => dto);
    return { gateway: { listRequests, getRequest: jest.fn() } as unknown as RequestGatewayOutputPort, listRequests };
}

const streaming = (rows: TransferRequestDTO[]) => gatewayReturning({ status: 'success', stream: Readable.from(rows) });

const request = (filter: RequestListFilter): AuthenticatedRequestModel<ListRequestsRequest> => ({ rucioAuthToken: 'token', filter });

describe('ListRequestsUseCase', () => {
    it('rejects half a pair before calling Rucio', async () => {
        const { presenter, captured } = capturingPresenter();
        const { gateway, listRequests } = streaming([]);
        await new ListRequestsUseCase(presenter, gateway).execute(request({ srcRse: 'CERN-PROD_DATADISK' }));
        expect(listRequests).not.toHaveBeenCalled();
        expect(captured.errors).toEqual([
            expect.objectContaining({ status: 'error', code: 400, name: 'ValidationError', message: 'Give both src_rse and dst_rse.' }),
        ]);
    });

    it('asks Rucio for the active states by default and streams every row', async () => {
        const { presenter, captured, done } = capturingPresenter();
        const { gateway, listRequests } = streaming([row(), row({ id: 'second', state: 'QUEUED' })]);
        await new ListRequestsUseCase(presenter, gateway).execute(request({ srcRse: 'A', dstRse: 'B' }));
        await done;
        expect(listRequests).toHaveBeenCalledWith('token', { kind: 'rse', src: 'A', dst: 'B' }, [...ACTIVE_REQUEST_STATES]);
        expect(captured.responses.map(response => response.id)).toEqual([expectedTransferRequest().id, 'second']);
        expect(captured.errors).toEqual([]);
    });

    it('sends a site link with the given states', async () => {
        const { presenter, done } = capturingPresenter();
        const { gateway, listRequests } = streaming([]);
        await new ListRequestsUseCase(presenter, gateway).execute(
            request({ srcSite: 'CERN-PROD', dstSite: 'BNL-ATLAS', requestStates: ['DONE', 'FAILED'] }),
        );
        await done;
        expect(listRequests).toHaveBeenCalledWith('token', { kind: 'site', src: 'CERN-PROD', dst: 'BNL-ATLAS' }, ['DONE', 'FAILED']);
    });

    it('keeps only rows of the requested activity and never drops error rows', async () => {
        const { presenter, captured, done } = capturingPresenter();
        const { gateway } = streaming([
            row(),
            row({ id: 'production-1', activity: 'Production' }),
            { status: 'error', errorCode: 500, errorMessage: 'bad line' } as TransferRequestDTO,
        ]);
        await new ListRequestsUseCase(presenter, gateway).execute(request({ srcRse: 'A', dstRse: 'B', activity: 'User Subscriptions' }));
        await done;
        expect(captured.responses.map(response => response.id)).toEqual([expectedTransferRequest().id]);
        expect(captured.errors).toEqual([expect.objectContaining({ status: 'error', code: 500, message: 'bad line' })]);
    });

    it('names the error after the Rucio exception class', async () => {
        const { presenter, captured } = capturingPresenter();
        const { gateway } = gatewayReturning({
            status: 'error',
            errorType: 'gateway_endpoint_error',
            errorCode: 500,
            errorName: 'Unknown Error',
            errorClass: 'AccessDenied',
            errorMessage: 'jdoe cannot list requests',
        });
        await new ListRequestsUseCase(presenter, gateway).execute(request({ srcRse: 'A', dstRse: 'B' }));
        expect(captured.errors).toEqual([expect.objectContaining({ code: 500, name: 'AccessDenied', message: 'jdoe cannot list requests' })]);
    });
});
