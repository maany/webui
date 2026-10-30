import RequestGatewayOutputPort from '@/lib/core/port/secondary/request-gateway-output-port';
import { ListRequestsError, ListRequestsRequest, ListRequestsResponse } from '@/lib/core/usecase-models/list-requests-usecase-models';
import { ListRequestsControllerParameters } from '@/lib/infrastructure/controller/list-requests-controller';
import ListRequestsController from '@/lib/infrastructure/controller/list-requests-controller';
import { TransferRequestViewModel } from '@/lib/infrastructure/data/view-model/request';
import { BaseStreamableFeature, IOCSymbols } from '@/lib/sdk/ioc-helpers';
import { FeatureKey } from '@/lib/core/entity/feature-config';
import GATEWAYS from '@/lib/infrastructure/ioc/ioc-symbols-gateway';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import INPUT_PORT from '@/lib/infrastructure/ioc/ioc-symbols-input-port';
import USECASE_FACTORY from '@/lib/infrastructure/ioc/ioc-symbols-usecase-factory';
import { Container } from 'inversify';

import ListRequestsUseCase from '@/lib/core/use-case/list-requests-usecase';
import ListRequestsPresenter from '@/lib/infrastructure/presenter/list-requests-presenter';

export default class ListRequestsFeature extends BaseStreamableFeature<
    ListRequestsControllerParameters,
    ListRequestsRequest,
    ListRequestsResponse,
    ListRequestsError,
    TransferRequestViewModel,
    FeatureKey
> {
    constructor(appContainer: Container) {
        const requestGateway = appContainer.get<RequestGatewayOutputPort>(GATEWAYS.REQUEST);

        const symbols: IOCSymbols = {
            CONTROLLER: CONTROLLERS.LIST_REQUESTS,
            USECASE_FACTORY: USECASE_FACTORY.LIST_REQUESTS,
            INPUT_PORT: INPUT_PORT.LIST_REQUESTS,
        };
        const useCaseConstructorArgs = [requestGateway];
        super('ListRequests', ListRequestsController, ListRequestsUseCase, useCaseConstructorArgs, ListRequestsPresenter, false, symbols, 'requests');
    }
}
