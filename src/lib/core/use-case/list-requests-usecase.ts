import { injectable } from 'inversify';
import { TransformCallback } from 'stream';
import { BaseSingleEndpointStreamingUseCase } from '@/lib/sdk/usecase';
import { AuthenticatedRequestModel } from '@/lib/sdk/usecase-models';

import { ListRequestsError, ListRequestsRequest, ListRequestsResponse } from '@/lib/core/usecase-models/list-requests-usecase-models';
import { ListRequestsInputPort, type ListRequestsOutputPort } from '@/lib/core/port/primary/list-requests-ports';
import { TransferRequestViewModel } from '@/lib/infrastructure/data/view-model/request';

import { ListRequestsDTO, TransferRequestDTO } from '@/lib/core/dto/request-dto';
import type RequestGatewayOutputPort from '@/lib/core/port/secondary/request-gateway-output-port';
import { resolveRequestStates, toRequestLink, validateRequestListFilter } from '@/lib/core/entity/request';

@injectable()
export default class ListRequestsUseCase
    extends BaseSingleEndpointStreamingUseCase<
        ListRequestsRequest,
        ListRequestsResponse,
        ListRequestsError,
        ListRequestsDTO,
        TransferRequestDTO,
        TransferRequestViewModel
    >
    implements ListRequestsInputPort
{
    /** Rucio's /requests/list has no activity filter, so rows are filtered here. */
    private activity: string | undefined;

    constructor(protected readonly presenter: ListRequestsOutputPort, private readonly gateway: RequestGatewayOutputPort) {
        super(presenter);
    }

    validateRequestModel(requestModel: AuthenticatedRequestModel<ListRequestsRequest>): ListRequestsError | undefined {
        const message = validateRequestListFilter(requestModel.filter ?? {});
        if (message) {
            return { status: 'error', code: 400, name: 'ValidationError', message } as ListRequestsError;
        }
        return undefined;
    }

    async intializeRequest(requestModel: AuthenticatedRequestModel<ListRequestsRequest>): Promise<ListRequestsError | undefined> {
        this.activity = requestModel.filter?.activity;
        return undefined;
    }

    async makeGatewayRequest(requestModel: AuthenticatedRequestModel<ListRequestsRequest>): Promise<ListRequestsDTO> {
        const { rucioAuthToken, filter } = requestModel;
        const link = toRequestLink(filter);
        if (!link) {
            return { status: 'error', errorCode: 400, errorName: 'ValidationError', errorMessage: 'Give a source and a destination.' };
        }
        return this.gateway.listRequests(rucioAuthToken, link, resolveRequestStates(filter.requestStates));
    }

    handleGatewayError(error: ListRequestsDTO): ListRequestsError {
        return {
            status: 'error',
            message: error.errorMessage ? error.errorMessage : 'Gateway Error',
            name: error.errorClass ?? error.errorName ?? 'Gateway Error',
            code: error.errorCode ?? 500,
        } as ListRequestsError;
    }

    processStreamedData(dto: TransferRequestDTO): { data: ListRequestsResponse | ListRequestsError; status: 'success' | 'error' } {
        if (dto.status === 'error') {
            const errorModel: ListRequestsError = {
                status: 'error',
                code: dto.errorCode || 500,
                message: dto.errorMessage || 'Could not fetch or process the fetched data',
                name: dto.errorClass ?? dto.errorName ?? 'Gateway Error',
            } as ListRequestsError;
            return { status: 'error', data: errorModel };
        }
        const responseModel: ListRequestsResponse = { ...dto, status: 'success' };
        return { status: 'success', data: responseModel };
    }

    /**
     * @override Drops rows of other activities. Error rows always pass.
     */
    _transform(dto: TransferRequestDTO, encoding: BufferEncoding, callback: TransformCallback): void {
        if (this.activity !== undefined && dto.status === 'success' && dto.activity !== this.activity) {
            callback();
            return;
        }
        super._transform(dto, encoding, callback);
    }
}
