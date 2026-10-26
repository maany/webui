import AssistantConfigGateway, { ASSISTANT_ENV_KEYS, resetAssistantConfigWarnings } from '@/lib/infrastructure/gateway/assistant-config-gateway';
import EnvConfigGateway from '@/lib/infrastructure/gateway/env-config-gateway';

const SALT = 'a-long-operator-salt-0123';
const ENDPOINT = 'https://otel.example.org/v1/traces';

const gateway = () => new AssistantConfigGateway(new EnvConfigGateway());

const setEnv = (values: Record<string, string>) => {
    Object.entries(values).forEach(([key, value]) => {
        process.env[key] = value;
    });
};

describe('AssistantConfigGateway.getTelemetryRelayConfig', () => {
    beforeEach(() => {
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        ASSISTANT_ENV_KEYS.forEach(key => {
            delete process.env[key];
        });
        resetAssistantConfigWarnings();
        jest.restoreAllMocks();
    });

    it('is undefined without an operator endpoint', async () => {
        await expect(gateway().getTelemetryRelayConfig()).resolves.toBeUndefined();
    });

    it.each(['nope', 'ftp://otel.example.org/v1/traces', '   '])('is undefined for the invalid endpoint %p, like operatorSink', async endpoint => {
        setEnv({ ASSISTANT_TELEMETRY_OTLP_ENDPOINT: endpoint });
        await expect(gateway().getTelemetryRelayConfig()).resolves.toBeUndefined();
        expect((await gateway().getAssistantConfig()).telemetry.operatorSink).toBe(false);
    });

    it('returns the endpoint, the parsed headers and the default rate limit, without a salt when hashUser is off', async () => {
        setEnv({
            ASSISTANT_TELEMETRY_OTLP_ENDPOINT: 'https://langfuse.example.org/api/public/otel/v1/traces/',
            ASSISTANT_TELEMETRY_OTLP_HEADERS: 'Authorization=Basic cGs6c2s=,x-langfuse-ingestion-version=4',
            ASSISTANT_TELEMETRY_USER_SALT: SALT,
        });
        await expect(gateway().getTelemetryRelayConfig()).resolves.toEqual({
            endpoint: 'https://langfuse.example.org/api/public/otel/v1/traces',
            headers: { Authorization: 'Basic cGs6c2s=', 'x-langfuse-ingestion-version': '4' },
            rateLimitPerMinute: 30,
            hashUser: false,
        });
        expect((await gateway().getAssistantConfig()).telemetry.operatorSink).toBe(true);
    });

    it.each([
        ['120', 120],
        ['0', 30],
        ['abc', 30],
        ['20000', 30],
    ])('reads ASSISTANT_RELAY_RATE_LIMIT=%p as %p', async (raw, expected) => {
        setEnv({ ASSISTANT_TELEMETRY_OTLP_ENDPOINT: ENDPOINT, ASSISTANT_RELAY_RATE_LIMIT: raw });
        expect((await gateway().getTelemetryRelayConfig())?.rateLimitPerMinute).toBe(expected);
    });

    it('carries the salt when hashUser is on', async () => {
        setEnv({ ASSISTANT_TELEMETRY_OTLP_ENDPOINT: ENDPOINT, ASSISTANT_TELEMETRY_HASH_USER: 'true', ASSISTANT_TELEMETRY_USER_SALT: ` ${SALT} ` });
        await expect(gateway().getTelemetryRelayConfig()).resolves.toMatchObject({ hashUser: true, userSalt: SALT });
        expect((await gateway().getAssistantConfig()).telemetry.operatorSink).toBe(true);
    });

    it.each([[undefined], ['short-salt-15ch']])('is undefined when hashUser is on and the salt is %p, like operatorSink', async salt => {
        setEnv({ ASSISTANT_TELEMETRY_OTLP_ENDPOINT: ENDPOINT, ASSISTANT_TELEMETRY_HASH_USER: 'true' });
        if (salt !== undefined) setEnv({ ASSISTANT_TELEMETRY_USER_SALT: salt });
        await expect(gateway().getTelemetryRelayConfig()).resolves.toBeUndefined();
        expect((await gateway().getAssistantConfig()).telemetry.operatorSink).toBe(false);
    });

    it('takes the salt from getTelemetryUserSalt', async () => {
        setEnv({ ASSISTANT_TELEMETRY_OTLP_ENDPOINT: ENDPOINT, ASSISTANT_TELEMETRY_HASH_USER: 'true' });
        const saltSpy = jest.spyOn(AssistantConfigGateway.prototype, 'getTelemetryUserSalt').mockResolvedValue('salt-from-the-port-1234');
        await expect(gateway().getTelemetryRelayConfig()).resolves.toMatchObject({ hashUser: true, userSalt: 'salt-from-the-port-1234' });
        expect(saltSpy).toHaveBeenCalledTimes(1);
    });

    it('never puts the endpoint, the headers or the salt in the browser config', async () => {
        setEnv({
            ASSISTANT_TELEMETRY_OTLP_ENDPOINT: ENDPOINT,
            ASSISTANT_TELEMETRY_OTLP_HEADERS: 'Authorization=Basic c2VjcmV0',
            ASSISTANT_TELEMETRY_HASH_USER: 'true',
            ASSISTANT_TELEMETRY_USER_SALT: SALT,
        });
        const browserConfig = JSON.stringify(await gateway().getAssistantConfig());
        expect(browserConfig).not.toContain('otel.example.org');
        expect(browserConfig).not.toContain('c2VjcmV0');
        expect(browserConfig).not.toContain(SALT);
    });
});
