import GetAssistantConfigUseCase from '@/lib/core/use-case/get-assistant-config-usecase';
import { GetAssistantConfigOutputPort } from '@/lib/core/port/primary/get-assistant-config-ports';
import { GetAssistantConfigError, GetAssistantConfigResponse } from '@/lib/core/usecase-models/get-assistant-config-usecase-models';
import type AssistantConfigGatewayOutputPort from '@/lib/core/port/secondary/assistant-config-gateway-output-port';
import { DEFAULT_ASSISTANT_CONFIG } from '@/lib/core/entity/assistant/assistant-config';
import { Signal } from '@/lib/sdk/web';

async function run(gateway: AssistantConfigGatewayOutputPort) {
    const calls: { success?: GetAssistantConfigResponse; error?: GetAssistantConfigError } = {};
    const presenter: GetAssistantConfigOutputPort = {
        response: undefined as unknown as Signal,
        async presentSuccess(model: GetAssistantConfigResponse) {
            calls.success = model;
        },
        async presentError(model: GetAssistantConfigError) {
            calls.error = model;
        },
    };
    await new GetAssistantConfigUseCase(presenter, gateway).execute({ rucioAuthToken: 't' });
    return calls;
}

describe('GetAssistantConfigUseCase', () => {
    it('presents the gateway config', async () => {
        const gateway = {
            getAssistantConfig: jest.fn(async () => DEFAULT_ASSISTANT_CONFIG),
            getRelayConfig: jest.fn(),
            getTelemetryUserSalt: jest.fn(),
        };
        const calls = await run(gateway);
        expect(calls.success).toEqual({ status: 'success', config: DEFAULT_ASSISTANT_CONFIG });
        expect(gateway.getRelayConfig).not.toHaveBeenCalled();
    });

    it('presents a 500 error when the gateway throws', async () => {
        const gateway = {
            getAssistantConfig: jest.fn(async () => {
                throw new Error('boom');
            }),
            getRelayConfig: jest.fn(),
            getTelemetryUserSalt: jest.fn(),
        };
        expect((await run(gateway)).error).toMatchObject({ status: 'error', type: 'AssistantConfigUnavailableError', code: 500 });
    });
});
