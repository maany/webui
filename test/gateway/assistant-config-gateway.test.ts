import AssistantConfigGateway, { ASSISTANT_ENV_KEYS, resetAssistantConfigWarnings } from '@/lib/infrastructure/gateway/assistant-config-gateway';
import EnvConfigGateway from '@/lib/infrastructure/gateway/env-config-gateway';
import type AssistantConfigGatewayOutputPort from '@/lib/core/port/secondary/assistant-config-gateway-output-port';
import { DEFAULT_ASSISTANT_CONFIG } from '@/lib/core/entity/assistant/assistant-config';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import GATEWAYS from '@/lib/infrastructure/ioc/ioc-symbols-gateway';

const gateway = () => new AssistantConfigGateway(new EnvConfigGateway());

const setEnv = (values: Record<string, string>) => {
    Object.entries(values).forEach(([key, value]) => {
        process.env[key] = value;
    });
};

const SALT = 'k3y-0f-at-least-16';

describe('AssistantConfigGateway', () => {
    afterEach(() => {
        ASSISTANT_ENV_KEYS.forEach(key => {
            delete process.env[key];
        });
        resetAssistantConfigWarnings();
        jest.restoreAllMocks();
    });

    it('is bound in the IoC container', () => {
        expect(appContainer.get<AssistantConfigGatewayOutputPort>(GATEWAYS.ASSISTANT_CONFIG)).toBeInstanceOf(AssistantConfigGateway);
    });

    it('lists every ASSISTANT_* variable of the spec', () => {
        expect([...ASSISTANT_ENV_KEYS].sort()).toEqual(
            [
                'ASSISTANT_WRITE_POLICY_CAP',
                'ASSISTANT_HIGH_RISK_POLICY_CAP',
                'ASSISTANT_ALLOW_BYOK',
                'ASSISTANT_ALLOWED_PROVIDER_KINDS',
                'ASSISTANT_DEFAULT_PROVIDER_KIND',
                'ASSISTANT_DEFAULT_BASE_URL',
                'ASSISTANT_DEFAULT_API_KEY',
                'ASSISTANT_DEFAULT_MODEL',
                'ASSISTANT_DEFAULT_MODEL_LABEL',
                'ASSISTANT_DEFAULT_CONTEXT_WINDOW',
                'ASSISTANT_SKILLS_DIR',
                'ASSISTANT_TELEMETRY_OTLP_ENDPOINT',
                'ASSISTANT_TELEMETRY_OTLP_HEADERS',
                'ASSISTANT_TELEMETRY_ALLOW_USER_SINKS',
                'ASSISTANT_TELEMETRY_CONTENT_CAP',
                'ASSISTANT_TELEMETRY_HASH_USER',
                'ASSISTANT_TELEMETRY_USER_SALT',
                'ASSISTANT_PRICES_JSON',
                'ASSISTANT_RELAY_RATE_LIMIT',
                'ASSISTANT_LLM_UPSTREAM_TIMEOUT_MS',
                'ASSISTANT_LLM_UPSTREAM_MAX_MS',
                'ASSISTANT_LLM_MAX_CONCURRENT_STREAMS',
                'ASSISTANT_SCOPE_MODE',
                'ASSISTANT_SCOPE_EXTRA_TOPICS',
                'ASSISTANT_SCOPE_MODEL',
            ].sort(),
        );
    });

    it('returns the defaults when nothing is set', async () => {
        await expect(gateway().getAssistantConfig()).resolves.toEqual(DEFAULT_ASSISTANT_CONFIG);
        await expect(gateway().getRelayConfig()).resolves.toBeUndefined();
        await expect(gateway().getTelemetryUserSalt()).resolves.toBeUndefined();
    });

    it('does not share the default kinds array with callers', async () => {
        const config = await gateway().getAssistantConfig();
        config.allowedProviderKinds.pop();
        expect(DEFAULT_ASSISTANT_CONFIG.allowedProviderKinds).toHaveLength(4);
    });

    it.each([
        ['deny', 'deny'],
        ['ALLOW', 'allow'],
        [' ask ', 'ask'],
        ['sometimes', 'ask'],
        ['', 'ask'],
    ])('reads ASSISTANT_WRITE_POLICY_CAP=%p as %p', async (raw, expected) => {
        setEnv({ ASSISTANT_WRITE_POLICY_CAP: raw });
        expect((await gateway().getAssistantConfig()).writePolicyCap).toBe(expected);
    });

    it.each([
        ['deny', 'deny'],
        ['ask', 'ask'],
        ['allow', 'ask'],
        ['bogus', 'ask'],
    ])('reads ASSISTANT_HIGH_RISK_POLICY_CAP=%p as %p (never allow)', async (raw, expected) => {
        setEnv({ ASSISTANT_HIGH_RISK_POLICY_CAP: raw });
        expect((await gateway().getAssistantConfig()).highRiskPolicyCap).toBe(expected);
    });

    it.each([
        ['false', false],
        ['OFF', false],
        ['0', false],
        ['true', true],
        ['maybe', true],
    ])('reads ASSISTANT_ALLOW_BYOK=%p as %p', async (raw, expected) => {
        setEnv({ ASSISTANT_ALLOW_BYOK: raw });
        expect((await gateway().getAssistantConfig()).allowByok).toBe(expected);
    });

    it('keeps only known provider kinds, in order and without duplicates', async () => {
        setEnv({ ASSISTANT_ALLOWED_PROVIDER_KINDS: 'ollama, OPENAI ,bogus,ollama' });
        expect((await gateway().getAssistantConfig()).allowedProviderKinds).toEqual(['ollama', 'openai']);
    });

    it('falls back to every kind when no listed kind is valid', async () => {
        setEnv({ ASSISTANT_ALLOWED_PROVIDER_KINDS: 'gemini' });
        expect((await gateway().getAssistantConfig()).allowedProviderKinds).toEqual(DEFAULT_ASSISTANT_CONFIG.allowedProviderKinds);
    });

    it('describes the operator default model without its key', async () => {
        setEnv({
            ASSISTANT_DEFAULT_PROVIDER_KIND: 'anthropic',
            ASSISTANT_DEFAULT_BASE_URL: 'https://api.anthropic.com/',
            ASSISTANT_DEFAULT_API_KEY: 'sk-operator-secret',
            ASSISTANT_DEFAULT_MODEL: 'claude-sonnet-5-5',
            ASSISTANT_DEFAULT_MODEL_LABEL: 'Claude via CERN',
            ASSISTANT_DEFAULT_CONTEXT_WINDOW: '1000000',
        });
        const config = await gateway().getAssistantConfig();
        expect(config.defaultProvider).toEqual({ kind: 'anthropic', model: 'claude-sonnet-5-5', label: 'Claude via CERN', contextWindow: 1000000 });
        expect(JSON.stringify(config)).not.toContain('sk-operator-secret');
        expect(JSON.stringify(config)).not.toContain('api.anthropic.com');
    });

    it('uses the model as label, drops an invalid context window and defaults the kind', async () => {
        setEnv({
            ASSISTANT_DEFAULT_PROVIDER_KIND: 'gemini',
            ASSISTANT_DEFAULT_BASE_URL: 'https://llm.example.org/v1',
            ASSISTANT_DEFAULT_MODEL: 'gpt-oss-120b',
            ASSISTANT_DEFAULT_CONTEXT_WINDOW: 'lots',
        });
        expect((await gateway().getAssistantConfig()).defaultProvider).toEqual({
            kind: 'openai-compatible',
            model: 'gpt-oss-120b',
            label: 'gpt-oss-120b',
        });
    });

    it.each([
        [{ ASSISTANT_DEFAULT_BASE_URL: 'https://llm.example.org/v1' }],
        [{ ASSISTANT_DEFAULT_MODEL: 'gpt-oss-120b' }],
        [{ ASSISTANT_DEFAULT_BASE_URL: 'ftp://llm.example.org', ASSISTANT_DEFAULT_MODEL: 'gpt-oss-120b' }],
        [{ ASSISTANT_DEFAULT_BASE_URL: 'not a url', ASSISTANT_DEFAULT_MODEL: 'gpt-oss-120b' }],
    ])('has no operator default for incomplete settings %p', async values => {
        setEnv(values);
        expect((await gateway().getAssistantConfig()).defaultProvider).toBeUndefined();
        await expect(gateway().getRelayConfig()).resolves.toBeUndefined();
    });

    it('reports an operator telemetry sink without exposing its endpoint or headers', async () => {
        setEnv({
            ASSISTANT_TELEMETRY_OTLP_ENDPOINT: 'https://otel.example.org/v1/traces',
            ASSISTANT_TELEMETRY_OTLP_HEADERS: 'Authorization=Basic c2VjcmV0',
            ASSISTANT_TELEMETRY_ALLOW_USER_SINKS: 'false',
            ASSISTANT_TELEMETRY_CONTENT_CAP: 'FULL',
            ASSISTANT_TELEMETRY_HASH_USER: 'yes',
            ASSISTANT_TELEMETRY_USER_SALT: SALT,
        });
        const config = await gateway().getAssistantConfig();
        expect(config.telemetry).toEqual({ operatorSink: true, allowUserSinks: false, contentCap: 'full', hashUser: true });
        expect(JSON.stringify(config)).not.toContain('c2VjcmV0');
        expect(JSON.stringify(config)).not.toContain('otel.example.org');
        expect(JSON.stringify(config)).not.toContain(SALT);
    });

    it('needs no salt for the operator sink while hashUser is off', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        setEnv({ ASSISTANT_TELEMETRY_OTLP_ENDPOINT: 'https://otel.example.org/v1/traces', ASSISTANT_TELEMETRY_HASH_USER: 'false' });
        expect((await gateway().getAssistantConfig()).telemetry).toMatchObject({ operatorSink: true, hashUser: false });
        expect(warn).not.toHaveBeenCalled();
    });

    it.each([
        ['missing', undefined],
        ['blank', '   '],
        ['15 characters', 'abcdefghijklmno'],
        ['15 characters after trimming', '  abcdefghijklmno  '],
    ])('turns the operator sink off when hashUser is on and the salt is %s', async (_label, salt) => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        setEnv({ ASSISTANT_TELEMETRY_OTLP_ENDPOINT: 'https://otel.example.org/v1/traces', ASSISTANT_TELEMETRY_HASH_USER: 'true' });
        if (salt !== undefined) setEnv({ ASSISTANT_TELEMETRY_USER_SALT: salt });
        expect((await gateway().getAssistantConfig()).telemetry).toMatchObject({ operatorSink: false, hashUser: true });
        await expect(gateway().getTelemetryUserSalt()).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('ASSISTANT_TELEMETRY_USER_SALT');
    });

    it('warns about a missing salt only once per process', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        setEnv({ ASSISTANT_TELEMETRY_OTLP_ENDPOINT: 'https://otel.example.org/v1/traces', ASSISTANT_TELEMETRY_HASH_USER: 'true' });
        await gateway().getAssistantConfig();
        await gateway().getAssistantConfig();
        await new AssistantConfigGateway(new EnvConfigGateway()).getAssistantConfig();
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('does not warn about the salt without an operator endpoint', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        setEnv({ ASSISTANT_TELEMETRY_HASH_USER: 'true' });
        expect((await gateway().getAssistantConfig()).telemetry.operatorSink).toBe(false);
        expect(warn).not.toHaveBeenCalled();
    });

    it('accepts a salt of exactly 16 characters and returns it trimmed, server side only', async () => {
        setEnv({
            ASSISTANT_TELEMETRY_OTLP_ENDPOINT: 'https://otel.example.org/v1/traces',
            ASSISTANT_TELEMETRY_HASH_USER: 'true',
            ASSISTANT_TELEMETRY_USER_SALT: ' abcdefghijklmnop ',
        });
        const config = await gateway().getAssistantConfig();
        expect(config.telemetry.operatorSink).toBe(true);
        expect(JSON.stringify(config)).not.toContain('abcdefghijklmnop');
        await expect(gateway().getTelemetryUserSalt()).resolves.toBe('abcdefghijklmnop');
    });

    it('returns a valid salt even without an operator model or endpoint', async () => {
        setEnv({ ASSISTANT_TELEMETRY_USER_SALT: SALT });
        await expect(gateway().getRelayConfig()).resolves.toBeUndefined();
        await expect(gateway().getTelemetryUserSalt()).resolves.toBe(SALT);
    });

    it('ignores an invalid telemetry endpoint and content cap', async () => {
        setEnv({ ASSISTANT_TELEMETRY_OTLP_ENDPOINT: 'nope', ASSISTANT_TELEMETRY_CONTENT_CAP: 'everything' });
        const config = await gateway().getAssistantConfig();
        expect(config.telemetry.operatorSink).toBe(false);
        expect(config.telemetry.contentCap).toBe('metadata');
    });

    it('reads price overrides', async () => {
        setEnv({ ASSISTANT_PRICES_JSON: '{"gpt-oss-120b":{"inputPerMTok":0.1,"outputPerMTok":0.5}}' });
        expect((await gateway().getAssistantConfig()).pricesOverride).toEqual({ 'gpt-oss-120b': { inputPerMTok: 0.1, outputPerMTok: 0.5 } });
    });

    it.each(['{not json', '{"m":{"inputPerMTok":-1,"outputPerMTok":1}}', '[1,2]'])('ignores invalid ASSISTANT_PRICES_JSON %p', async raw => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        setEnv({ ASSISTANT_PRICES_JSON: raw });
        expect((await gateway().getAssistantConfig()).pricesOverride).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('builds the relay config with the key, a trimmed base URL and the default rate limit', async () => {
        setEnv({
            ASSISTANT_DEFAULT_BASE_URL: 'https://llm.example.org/v1///',
            ASSISTANT_DEFAULT_MODEL: 'gpt-oss-120b',
            ASSISTANT_DEFAULT_API_KEY: ' sk-operator-secret ',
        });
        await expect(gateway().getRelayConfig()).resolves.toEqual({
            kind: 'openai-compatible',
            baseURL: 'https://llm.example.org/v1',
            apiKey: 'sk-operator-secret',
            rateLimitPerMinute: 30,
            upstreamTimeoutMs: 120000,
            upstreamMaxMs: 600000,
            maxConcurrentStreams: 3,
            scope: { mode: 'warn', extraTopics: [], model: 'gpt-oss-120b' },
        });
    });

    it.each([
        ['5000', 5000],
        ['abc', 120000],
        ['-1', 120000],
        ['0', 120000],
        ['99999999999', 120000],
    ])('reads ASSISTANT_LLM_UPSTREAM_TIMEOUT_MS=%p as %p', async (raw, expected) => {
        setEnv({ ASSISTANT_DEFAULT_BASE_URL: 'https://llm.example.org/v1', ASSISTANT_DEFAULT_MODEL: 'm', ASSISTANT_LLM_UPSTREAM_TIMEOUT_MS: raw });
        await expect(gateway().getRelayConfig()).resolves.toMatchObject({ upstreamTimeoutMs: expected });
    });

    it.each([
        ['900000', 900000],
        ['abc', 600000],
        ['0', 600000],
        ['99999999999', 600000],
    ])('reads ASSISTANT_LLM_UPSTREAM_MAX_MS=%p as %p', async (raw, expected) => {
        setEnv({ ASSISTANT_DEFAULT_BASE_URL: 'https://llm.example.org/v1', ASSISTANT_DEFAULT_MODEL: 'm', ASSISTANT_LLM_UPSTREAM_MAX_MS: raw });
        await expect(gateway().getRelayConfig()).resolves.toMatchObject({ upstreamMaxMs: expected });
    });

    it.each([
        ['5', 5],
        ['abc', 3],
        ['0', 3],
        ['-2', 3],
        ['99999999999', 3],
    ])('reads ASSISTANT_LLM_MAX_CONCURRENT_STREAMS=%p as %p', async (raw, expected) => {
        setEnv({ ASSISTANT_DEFAULT_BASE_URL: 'https://llm.example.org/v1', ASSISTANT_DEFAULT_MODEL: 'm', ASSISTANT_LLM_MAX_CONCURRENT_STREAMS: raw });
        await expect(gateway().getRelayConfig()).resolves.toMatchObject({ maxConcurrentStreams: expected });
    });

    it.each([
        ['5', 5],
        ['10000', 10000],
        ['0', 30],
        ['-3', 30],
        ['many', 30],
        ['10001', 30],
    ])('reads ASSISTANT_RELAY_RATE_LIMIT=%p as %p', async (raw, expected) => {
        setEnv({ ASSISTANT_DEFAULT_BASE_URL: 'https://llm.example.org/v1', ASSISTANT_DEFAULT_MODEL: 'm', ASSISTANT_RELAY_RATE_LIMIT: raw });
        expect((await gateway().getRelayConfig())?.rateLimitPerMinute).toBe(expected);
    });

    it('omits the key from the relay config when none is set', async () => {
        setEnv({ ASSISTANT_DEFAULT_BASE_URL: 'http://vllm.internal:8000/v1', ASSISTANT_DEFAULT_MODEL: 'qwen3' });
        const relay = await gateway().getRelayConfig();
        expect(relay).toBeDefined();
        expect(relay).not.toHaveProperty('apiKey');
    });
});
