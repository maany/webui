import { injectable, inject } from 'inversify';
import { Signal } from '@/lib/sdk/web';

import { AuthenticatedRequestModel } from '@/lib/sdk/usecase-models';
import { BaseController, TAuthenticatedControllerParameters } from '@/lib/sdk/controller';
import { ListRequestsRequest } from '@/lib/core/usecase-models/list-requests-usecase-models';
import { ListRequestsInputPort } from '@/lib/core/port/primary/list-requests-ports';
import { RequestListFilter } from '@/lib/core/entity/request';
import USECASE_FACTORY from '@/lib/infrastructure/ioc/ioc-symbols-usecase-factory';

export type ListRequestsControllerParameters = TAuthenticatedControllerParameters & {
    filter: RequestListFilter;
};

@injectable()
class ListRequestsController extends BaseController<ListRequestsControllerParameters, AuthenticatedRequestModel<ListRequestsRequest>> {
    constructor(@inject(USECASE_FACTORY.LIST_REQUESTS) listRequestsUseCaseFactory: (response: Signal) => ListRequestsInputPort) {
        super(listRequestsUseCaseFactory);
    }
    prepareRequestModel(parameters: ListRequestsControllerParameters): AuthenticatedRequestModel<ListRequestsRequest> {
        return {
            rucioAuthToken: parameters.rucioAuthToken,
            filter: parameters.filter,
        };
    }
}

export default ListRequestsController;
