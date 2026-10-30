import { BasePresenter } from '@/lib/sdk/presenter';
import { GetAssistantConfigError, GetAssistantConfigResponse } from '@/lib/core/usecase-models/get-assistant-config-usecase-models';
import { AssistantConfigViewModel } from '../data/view-model/assistant-config';

export default class GetAssistantConfigPresenter extends BasePresenter<
    GetAssistantConfigResponse,
    GetAssistantConfigError,
    AssistantConfigViewModel
> {
    convertResponseModelToViewModel(responseModel: GetAssistantConfigResponse): { viewModel: AssistantConfigViewModel; status: number } {
        return {
            status: 200,
            viewModel: { status: 'success', ...responseModel.config },
        };
    }

    convertErrorModelToViewModel(errorModel: GetAssistantConfigError): { viewModel: AssistantConfigViewModel; status: number } {
        return {
            status: errorModel.code || 500,
            viewModel: {
                status: 'error',
                message: errorModel.message,
                errorType: errorModel.type === 'AssistantConfigUnavailableError' ? 'config_unavailable' : 'unknown',
            },
        };
    }
}
