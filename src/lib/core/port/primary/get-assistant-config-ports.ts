import { BaseAuthenticatedInputPort, BaseOutputPort } from '@/lib/sdk/primary-ports';
import {
    GetAssistantConfigError,
    GetAssistantConfigRequest,
    GetAssistantConfigResponse,
} from '@/lib/core/usecase-models/get-assistant-config-usecase-models';

/**
 * @interface GetAssistantConfigInputPort representing the GetAssistantConfig usecase.
 */
export interface GetAssistantConfigInputPort extends BaseAuthenticatedInputPort<GetAssistantConfigRequest> {}

/**
 * @interface GetAssistantConfigOutputPort representing the GetAssistantConfig presenter.
 */
export interface GetAssistantConfigOutputPort extends BaseOutputPort<GetAssistantConfigResponse, GetAssistantConfigError> {}
