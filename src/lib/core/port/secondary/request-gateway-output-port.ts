import { ListRequestsDTO, RequestDTO } from '../../dto/request-dto';
import { RequestLink, RequestState } from '@/lib/core/entity/request';

// RequestGatewayOutputPort interface defines the contract for a gateway that retrieves requests from RUCIO.
export default interface RequestGatewayOutputPort {
    /**
     * Retrieves a request by its RUCIO Auth Token, scope, name, and RSE.
     * @param rucioAuthToken - The authentication token for RUCIO.
     * @param scope - The scope of the request.
     * @param name - The name of the request.
     * @param rse - The RSE (RUCIO Storage Element) associated with the request.
     * @returns A Promise that resolves to a RequestDTO containing the request details.
     */
    getRequest(rucioAuthToken: string, scope: string, name: string, rse: string): Promise<RequestDTO>;

    /**
     * Streams the transfer requests of one link (GET /requests/list).
     * Rucio's default policy only allows root and accounts with the admin attribute.
     * @param rucioAuthToken - The authentication token for RUCIO.
     * @param link - An RSE pair or a site pair.
     * @param requestStates - States to include, at least one.
     * @returns ListRequestsDTO whose stream carries TransferRequestDTO objects, or an error DTO
     * (errorClass carries Rucio's ExceptionClass, e.g. AccessDenied or RSENotFound).
     */
    listRequests(rucioAuthToken: string, link: RequestLink, requestStates: RequestState[]): Promise<ListRequestsDTO>;
}
