import { BaseErrorResponseModel, BaseResponseModel } from '@/lib/sdk/usecase-models';
import type { AssistantConfig } from '@/lib/core/entity/assistant/assistant-config';

/** The route takes no parameters: the config is the same for every signed-in user. */
export type GetAssistantConfigRequest = object;

export interface GetAssistantConfigResponse extends BaseResponseModel {
    config: AssistantConfig;
}

export interface AssistantConfigUnavailableError extends BaseErrorResponseModel {
    type: 'AssistantConfigUnavailableError';
}

export type GetAssistantConfigError = AssistantConfigUnavailableError;
