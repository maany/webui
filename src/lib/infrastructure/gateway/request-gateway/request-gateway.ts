import { ListRequestsDTO, RequestDTO } from '@/lib/core/dto/request-dto';
import { RequestLink, RequestState } from '@/lib/core/entity/request';
import RequestGatewayOutputPort from '@/lib/core/port/secondary/request-gateway-output-port';
import { injectable } from 'inversify';
import GetRequestEndpoint from './endpoints/get-request-endpoint';
import ListRequestsEndpoint from './endpoints/list-requests-endpoint';

@injectable()
export default class RequestGateway implements RequestGatewayOutputPort {
    async getRequest(rucioAuthToken: string, scope: string, name: string, rse: string): Promise<RequestDTO> {
        try {
            const endpoint = new GetRequestEndpoint(rucioAuthToken, scope, name, rse);
            const dto: RequestDTO = await endpoint.fetch();
            return Promise.resolve(dto);
        } catch (error) {
            const errorDTO: RequestDTO = {
                status: 'error',
                errorName: 'Unknown Error',
                errorType: 'gateway_endpoint_error',
                errorCode: 500,
                errorMessage: error?.toString(),
            };
            return Promise.resolve(errorDTO);
        }
    }

    async listRequests(rucioAuthToken: string, link: RequestLink, requestStates: RequestState[]): Promise<ListRequestsDTO> {
        try {
            const endpoint = new ListRequestsEndpoint(rucioAuthToken, link, requestStates);
            const errorDTO: ListRequestsDTO | undefined = await endpoint.fetch();
            if (!errorDTO) {
                return {
                    status: 'success',
                    stream: endpoint,
                };
            }
            return errorDTO;
        } catch (error) {
            const errorDTO: ListRequestsDTO = {
                status: 'error',
                errorName: 'Exception occurred while listing requests',
                errorType: 'gateway_endpoint_error',
                errorCode: 500,
                errorMessage: error?.toString(),
            };
            return Promise.resolve(errorDTO);
        }
    }
}
