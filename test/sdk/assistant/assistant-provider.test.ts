import { resolveActiveProvider } from '@/lib/core/services/assistant-provider';
import { DEFAULT_ASSISTANT_CONFIG, type AssistantConfig } from '@/lib/core/entity/assistant/assistant-config';
import type { AssistantSettings } from '@/lib/core/entity/assistant/settings';
import type { ModelPricing, ProviderConfig } from '@/lib/core/entity/assistant/provider-config';

const RELAY = '/api/assistant/llm';
const CATALOG: Record<string, { contextWindow?: number; pricing?: ModelPricing }> = {
    'gpt-oss-120b': { contextWindow: 131_072 },
    'claude-sonnet-5-5': { contextWindow: 1_000_000, pricing: { inputPerMTok: 2, outputPerMTok: 10, cachedInputPerMTok: 0.2 } },
};
const catalog = (model: string) => CATALOG[model];

const claude: ProviderConfig = { id: 'p-claude', kind: 'anthropic', label: 'My Claude', apiKey: 'sk-ant', model: 'claude-sonnet-5-5' };
const ollama: ProviderConfig = {
    id: 'p-ollama',
    kind: 'ollama',
    label: 'Local',
    baseURL: 'http://localhost:11434',
    model: 'my-model',
    contextWindow: 8192,
};

const settings = (overrides: Partial<AssistantSettings> = {}): AssistantSettings => ({
    version: 1,
    providers: [claude, ollama],
    activeProviderId: 'operator',
    keyStorage: 'local',
    toolPolicies: {},
    skills: { enabled: {}, user: [] },
    telemetry: { contentLevel: 'metadata', enabled: false, shareWithOperator: false },
    display: { detail: 'compact' },
    retention: { maxAgeDays: 30, maxTotalMB: 50, clearOnLogout: false },
    ...overrides,
});

const withOperator: AssistantConfig = {
    ...DEFAULT_ASSISTANT_CONFIG,
    defaultProvider: { kind: 'openai-compatible', model: 'gpt-oss-120b', label: 'CERN GPT-OSS' },
};

describe('resolveActiveProvider', () => {
    it('resolves the operator default through the relay without a key', () => {
        const resolved = resolveActiveProvider(settings(), withOperator, RELAY, catalog);
        expect(resolved).toEqual({
            providerId: 'operator',
            kind: 'openai-compatible',
            model: 'gpt-oss-120b',
            baseURL: RELAY,
            via: 'relay',
            contextWindow: 131_072,
        });
        expect(resolved).not.toHaveProperty('apiKey');
    });

    it('prefers the operator context window and price override over the catalog', () => {
        const config: AssistantConfig = {
            ...withOperator,
            defaultProvider: { ...withOperator.defaultProvider!, contextWindow: 65_536 },
            pricesOverride: { 'gpt-oss-120b': { inputPerMTok: 0.1, outputPerMTok: 0.4 } },
        };
        expect(resolveActiveProvider(settings(), config, RELAY, catalog)).toMatchObject({
            contextWindow: 65_536,
            pricing: { inputPerMTok: 0.1, outputPerMTok: 0.4 },
        });
    });

    it('reports no-provider when the operator default is selected but missing', () => {
        expect(resolveActiveProvider(settings(), DEFAULT_ASSISTANT_CONFIG, RELAY, catalog)).toEqual({ error: 'no-provider' });
    });

    it('reports no-provider for an unknown provider id', () => {
        expect(resolveActiveProvider(settings({ activeProviderId: 'gone' }), withOperator, RELAY, catalog)).toEqual({ error: 'no-provider' });
    });

    it('resolves a BYOK provider directly with its key and catalog data', () => {
        expect(resolveActiveProvider(settings({ activeProviderId: 'p-claude' }), withOperator, RELAY, catalog)).toEqual({
            providerId: 'p-claude',
            kind: 'anthropic',
            model: 'claude-sonnet-5-5',
            apiKey: 'sk-ant',
            via: 'direct',
            contextWindow: 1_000_000,
            pricing: { inputPerMTok: 2, outputPerMTok: 10, cachedInputPerMTok: 0.2 },
        });
    });

    it('keeps the user base URL and context window for unknown models', () => {
        expect(resolveActiveProvider(settings({ activeProviderId: 'p-ollama' }), withOperator, RELAY, catalog)).toEqual({
            providerId: 'p-ollama',
            kind: 'ollama',
            model: 'my-model',
            baseURL: 'http://localhost:11434',
            via: 'direct',
            contextWindow: 8192,
        });
    });

    it('applies pricing precedence: operator override, then provider, then catalog', () => {
        const priced: ProviderConfig = { ...claude, pricing: { inputPerMTok: 9, outputPerMTok: 9 } };
        const s = settings({ providers: [priced], activeProviderId: 'p-claude' });
        expect(resolveActiveProvider(s, withOperator, RELAY, catalog)).toMatchObject({ pricing: { inputPerMTok: 9, outputPerMTok: 9 } });
        const config = { ...withOperator, pricesOverride: { 'claude-sonnet-5-5': { inputPerMTok: 1, outputPerMTok: 1 } } };
        expect(resolveActiveProvider(s, config, RELAY, catalog)).toMatchObject({ pricing: { inputPerMTok: 1, outputPerMTok: 1 } });
    });

    it('refuses BYOK providers when the operator turned BYOK off', () => {
        expect(resolveActiveProvider(settings({ activeProviderId: 'p-claude' }), { ...withOperator, allowByok: false }, RELAY, catalog)).toEqual({
            error: 'byok-disabled',
        });
    });

    it('refuses provider kinds the operator does not allow', () => {
        expect(
            resolveActiveProvider(settings({ activeProviderId: 'p-claude' }), { ...withOperator, allowedProviderKinds: ['ollama'] }, RELAY, catalog),
        ).toEqual({ error: 'kind-not-allowed' });
    });
});
