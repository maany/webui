import AssistantConfigGateway, { ASSISTANT_ENV_KEYS, resetAssistantConfigWarnings } from '@/lib/infrastructure/gateway/assistant-config-gateway';
import EnvConfigGateway from '@/lib/infrastructure/gateway/env-config-gateway';

const gateway = () => new AssistantConfigGateway(new EnvConfigGateway());

describe('AssistantConfigGateway ASSISTANT_MAX_TOOL_CALLS', () => {
    afterEach(() => {
        ASSISTANT_ENV_KEYS.forEach(key => {
            delete process.env[key];
        });
        resetAssistantConfigWarnings();
    });

    it('leaves the per-turn tool call budget unset by default', async () => {
        expect((await gateway().getAssistantConfig()).maxToolCallsPerTurn).toBeUndefined();
    });

    it.each([
        ['5', 5],
        ['20', 20],
        ['200', 200],
        ['0', undefined],
        ['-1', undefined],
        ['many', undefined],
        ['201', undefined],
    ])('reads ASSISTANT_MAX_TOOL_CALLS=%p as %p', async (raw, expected) => {
        process.env.ASSISTANT_MAX_TOOL_CALLS = raw;
        expect((await gateway().getAssistantConfig()).maxToolCallsPerTurn).toBe(expected);
    });
});
