import { injectable, inject } from 'inversify';
import { Signal } from '@/lib/sdk/web';
import { AuthenticatedRequestModel } from '@/lib/sdk/usecase-models';
import { BaseController, TAuthenticatedControllerParameters } from '@/lib/sdk/controller';
import { GetAssistantConfigRequest } from '@/lib/core/usecase-models/get-assistant-config-usecase-models';
import { GetAssistantConfigInputPort } from '@/lib/core/port/primary/get-assistant-config-ports';
import USECASE_FACTORY from '@/lib/infrastructure/ioc/ioc-symbols-usecase-factory';

export type GetAssistantConfigControllerParameters = TAuthenticatedControllerParameters;

@injectable()
class GetAssistantConfigController extends BaseController<
    GetAssistantConfigControllerParameters,
    AuthenticatedRequestModel<GetAssistantConfigRequest>
> {
    constructor(@inject(USECASE_FACTORY.GET_ASSISTANT_CONFIG) getAssistantConfigUseCaseFactory: (response: Signal) => GetAssistantConfigInputPort) {
        super(getAssistantConfigUseCaseFactory);
    }

    prepareRequestModel(parameters: GetAssistantConfigControllerParameters): AuthenticatedRequestModel<GetAssistantConfigRequest> {
        return { rucioAuthToken: parameters.rucioAuthToken };
    }
}

export default GetAssistantConfigController;
