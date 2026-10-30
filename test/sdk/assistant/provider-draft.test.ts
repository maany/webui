import {
    draftFromProvider,
    emptyProviderDraft,
    providerFromDraft,
    validateProviderDraft,
    type ProviderDraft,
} from '@/component-library/features/assistant/settings/provider-draft';
import type { ProviderConfig } from '@/lib/core/entity/assistant/provider-config';

const knownOnly = (model: string) => (model === 'claude-sonnet-5-5' ? { contextWindow: 1_000_000 } : undefined);
const draft = (overrides: Partial<ProviderDraft> = {}): ProviderDraft => ({ ...emptyProviderDraft('anthropic'), ...overrides });

describe('validateProviderDraft', () => {
    it('requires a name, a model and a key for Anthropic', () => {
        expect(validateProviderDraft(draft(), knownOnly)).toEqual({
            label: 'Enter a name for this provider.',
            model: 'Enter a model id.',
            apiKey: 'This provider type needs an API key.',
        });
    });

    it('accepts a complete Anthropic draft for a known model', () => {
        expect(validateProviderDraft(draft({ label: 'Mine', apiKey: 'sk', model: 'claude-sonnet-5-5' }), knownOnly)).toEqual({});
    });

    it.each(['ftp://x', 'javascript:alert(1)'])('rejects the base URL %s', baseURL => {
        const base = { kind: 'openai-compatible' as const, label: 'Gateway', model: 'claude-sonnet-5-5' };
        expect(validateProviderDraft(draft({ ...base, baseURL }), knownOnly).baseURL).toBe('Enter a full URL that starts with http:// or https://.');
    });

    it('needs a base URL for OpenAI-compatible providers and checks its shape', () => {
        const base = { kind: 'openai-compatible' as const, label: 'Gateway', model: 'claude-sonnet-5-5' };
        expect(validateProviderDraft(draft(base), knownOnly).baseURL).toBe('This provider type needs a base URL.');
        expect(validateProviderDraft(draft({ ...base, baseURL: 'litellm.example.org' }), knownOnly).baseURL).toBe(
            'Enter a full URL that starts with http:// or https://.',
        );
        expect(validateProviderDraft(draft({ ...base, baseURL: 'https://litellm.example.org/v1' }), knownOnly)).toEqual({});
    });

    it('does not need a key for Ollama', () => {
        expect(validateProviderDraft(draft({ kind: 'ollama', label: 'Local', model: 'claude-sonnet-5-5' }), knownOnly)).toEqual({});
    });

    it('asks for a context window for unknown models and checks it', () => {
        const base = { kind: 'ollama' as const, label: 'Local', model: 'my-model' };
        expect(validateProviderDraft(draft(base), knownOnly).contextWindow).toBe('Unknown model. Enter its context window in tokens.');
        expect(validateProviderDraft(draft({ ...base, contextWindow: '12.5' }), knownOnly).contextWindow).toBe('Enter a whole number of tokens.');
        expect(validateProviderDraft(draft({ ...base, contextWindow: '0' }), knownOnly).contextWindow).toBe('Enter a whole number of tokens.');
        expect(validateProviderDraft(draft({ ...base, contextWindow: '32768' }), knownOnly)).toEqual({});
    });

    it('needs both prices when one is given', () => {
        const base = { label: 'Mine', apiKey: 'sk', model: 'claude-sonnet-5-5' };
        expect(validateProviderDraft(draft({ ...base, inputPerMTok: '3' }), knownOnly)).toEqual({
            outputPerMTok: 'Enter a price in USD, for example 15 or 1.25.',
        });
        expect(validateProviderDraft(draft({ ...base, inputPerMTok: 'abc', outputPerMTok: '15' }), knownOnly)).toEqual({
            inputPerMTok: 'Enter a price in USD, for example 3 or 0.25.',
        });
        expect(validateProviderDraft(draft({ ...base, inputPerMTok: '0.25', outputPerMTok: '1.25' }), knownOnly)).toEqual({});
    });
});

describe('providerFromDraft', () => {
    it('trims values, drops empty ones and converts numbers', () => {
        const provider = providerFromDraft(
            draft({
                kind: 'openai-compatible',
                label: ' Gateway ',
                baseURL: 'https://litellm.example.org/v1/ ',
                apiKey: ' ',
                model: ' gpt-oss-120b ',
                contextWindow: '131072',
                inputPerMTok: '0.1',
                outputPerMTok: '0.5',
            }),
            'p-1',
        );
        expect(provider).toEqual({
            id: 'p-1',
            kind: 'openai-compatible',
            label: 'Gateway',
            baseURL: 'https://litellm.example.org/v1',
            model: 'gpt-oss-120b',
            contextWindow: 131072,
            pricing: { inputPerMTok: 0.1, outputPerMTok: 0.5 },
        });
    });

    it('round-trips through draftFromProvider', () => {
        const original: ProviderConfig = {
            id: 'p-2',
            kind: 'ollama',
            label: 'Local',
            baseURL: 'http://localhost:11434',
            model: 'qwen3',
            contextWindow: 40960,
            pricing: { inputPerMTok: 0, outputPerMTok: 0 },
        };
        expect(providerFromDraft(draftFromProvider(original), 'p-2')).toEqual(original);
    });
});
