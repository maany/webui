import { Container } from 'inversify';
import { BaseFeature, IOCSymbols } from '@/lib/sdk/ioc-helpers';
import { FeatureKey } from '@/lib/core/entity/feature-config';
import {
    GetAssistantConfigError,
    GetAssistantConfigRequest,
    GetAssistantConfigResponse,
} from '@/lib/core/usecase-models/get-assistant-config-usecase-models';
import GetAssistantConfigController, {
    GetAssistantConfigControllerParameters,
} from '@/lib/infrastructure/controller/get-assistant-config-controller';
import GetAssistantConfigUseCase from '@/lib/core/use-case/get-assistant-config-usecase';
import GetAssistantConfigPresenter from '@/lib/infrastructure/presenter/get-assistant-config-presenter';
import { AssistantConfigViewModel } from '@/lib/infrastructure/data/view-model/assistant-config';
import AssistantConfigGatewayOutputPort from '@/lib/core/port/secondary/assistant-config-gateway-output-port';
import GATEWAYS from '@/lib/infrastructure/ioc/ioc-symbols-gateway';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import INPUT_PORT from '@/lib/infrastructure/ioc/ioc-symbols-input-port';
import USECASE_FACTORY from '@/lib/infrastructure/ioc/ioc-symbols-usecase-factory';

export default class GetAssistantConfigFeature extends BaseFeature<
    GetAssistantConfigControllerParameters,
    GetAssistantConfigRequest,
    GetAssistantConfigResponse,
    GetAssistantConfigError,
    AssistantConfigViewModel,
    FeatureKey
> {
    constructor(appContainer: Container) {
        const assistantConfigGateway = appContainer.get<AssistantConfigGatewayOutputPort>(GATEWAYS.ASSISTANT_CONFIG);
        const symbols: IOCSymbols = {
            CONTROLLER: CONTROLLERS.GET_ASSISTANT_CONFIG,
            USECASE_FACTORY: USECASE_FACTORY.GET_ASSISTANT_CONFIG,
            INPUT_PORT: INPUT_PORT.GET_ASSISTANT_CONFIG,
        };
        // All three assistant flags are claimed here (the coverage test needs every key claimed).
        // withFeature answers 404 unless ANY of them is on, and the children imply the parent,
        // so this behaves exactly like gating on 'assistant'.
        super(
            'GetAssistantConfig',
            GetAssistantConfigController,
            GetAssistantConfigUseCase,
            [assistantConfigGateway],
            GetAssistantConfigPresenter,
            false,
            symbols,
            ['assistant', 'assistant.write', 'assistant.bad_replicas'],
        );
    }
}
