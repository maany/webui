import { ListRequestsDTO, TransferRequestDTO } from '@/lib/core/dto/request-dto';
import { REQUEST_STATE_CODES, RequestLink, RequestState } from '@/lib/core/entity/request';
import { BaseStreamableEndpoint } from '@/lib/sdk/gateway-endpoints';
import { HTTPRequest } from '@/lib/sdk/http';
import { convertToTransferRequestDTO, parseRequestLine } from '../request-gateway-utils';

/**
 * Streams the requests of one link (GET /requests/list).
 * Rucio parses request_states by value, so the one letter codes are sent, comma separated.
 */
export default class ListRequestsEndpoint extends BaseStreamableEndpoint<ListRequestsDTO, TransferRequestDTO> {
    constructor(private readonly rucioAuthToken: string, private readonly link: RequestLink, private readonly requestStates: RequestState[]) {
        super();
    }

    async initialize(): Promise<void> {
        await super.initialize();
        const params: { [key: string]: string } =
            this.link.kind === 'rse' ? { src_rse: this.link.src, dst_rse: this.link.dst } : { src_site: this.link.src, dst_site: this.link.dst };
        params.request_states = this.requestStates.map(state => REQUEST_STATE_CODES[state]).join(',');

        const request: HTTPRequest = {
            method: 'GET',
            url: `${this.rucioHost}/requests/list`,
            params,
            headers: { 'X-Rucio-Auth-Token': this.rucioAuthToken, Accept: 'application/x-json-stream' },
            body: null,
        };
        this.request = request;
        this.initialized = true;
    }

    async reportErrors(): Promise<ListRequestsDTO | undefined> {
        return undefined; // handled by handleCommonGatewayEndpointErrors
    }

    createDTO(response: Buffer): TransferRequestDTO {
        return convertToTransferRequestDTO(parseRequestLine(response));
    }
}
