import { injectable } from 'inversify';
import { AuthenticatedRequestModel } from '@/lib/sdk/usecase-models';
import { GetAssistantConfigRequest } from '@/lib/core/usecase-models/get-assistant-config-usecase-models';
import { GetAssistantConfigInputPort, type GetAssistantConfigOutputPort } from '@/lib/core/port/primary/get-assistant-config-ports';
import type AssistantConfigGatewayOutputPort from '@/lib/core/port/secondary/assistant-config-gateway-output-port';

@injectable()
export default class GetAssistantConfigUseCase implements GetAssistantConfigInputPort {
    constructor(
        private readonly presenter: GetAssistantConfigOutputPort,
        private readonly assistantConfigGateway: AssistantConfigGatewayOutputPort,
    ) {}

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async execute(requestModel: AuthenticatedRequestModel<GetAssistantConfigRequest>): Promise<void> {
        try {
            const config = await this.assistantConfigGateway.getAssistantConfig();
            await this.presenter.presentSuccess({ status: 'success', config });
        } catch {
            await this.presenter.presentError({
                status: 'error',
                name: 'AssistantConfigUnavailableError',
                type: 'AssistantConfigUnavailableError',
                message: 'Could not read the assistant configuration',
                code: 500,
            });
        }
    }
}
