import GetAssistantConfigPresenter from '@/lib/infrastructure/presenter/get-assistant-config-presenter';
import { GetAssistantConfigError } from '@/lib/core/usecase-models/get-assistant-config-usecase-models';
import { DEFAULT_ASSISTANT_CONFIG } from '@/lib/core/entity/assistant/assistant-config';

describe('GetAssistantConfigPresenter', () => {
    const presenter = new GetAssistantConfigPresenter(undefined as never);

    it('flattens the config into a success view model', () => {
        expect(presenter.convertResponseModelToViewModel({ status: 'success', config: DEFAULT_ASSISTANT_CONFIG })).toEqual({
            status: 200,
            viewModel: { status: 'success', ...DEFAULT_ASSISTANT_CONFIG },
        });
    });

    it('maps the unavailable error to config_unavailable', () => {
        const error: GetAssistantConfigError = {
            status: 'error',
            name: 'AssistantConfigUnavailableError',
            type: 'AssistantConfigUnavailableError',
            message: 'Could not read the assistant configuration',
            code: 500,
        };
        expect(presenter.convertErrorModelToViewModel(error)).toEqual({
            status: 500,
            viewModel: { status: 'error', message: 'Could not read the assistant configuration', errorType: 'config_unavailable' },
        });
    });

    it('maps anything else to unknown', () => {
        const error = { status: 'error', name: 'Error', type: 'Other', message: '', code: 0 } as unknown as GetAssistantConfigError;
        const { status, viewModel } = presenter.convertErrorModelToViewModel(error);
        expect(status).toBe(500);
        expect(viewModel.errorType).toBe('unknown');
    });
});
