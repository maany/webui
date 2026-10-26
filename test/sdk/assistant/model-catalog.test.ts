import { catalogModelIds, lookupModel, normalizeModelId } from '@/lib/infrastructure/assistant/model-catalog';
import { BYOK_PROVIDER_KINDS } from '@/lib/core/entity/assistant/provider-config';
import {
    ANTHROPIC_API_VERSION,
    ASSISTANT_RELAY_BASE_URL,
    DEFAULT_BASE_URLS,
    KIND_NEEDS_API_KEY,
    KIND_NEEDS_BASE_URL,
    PROVIDER_KIND_LABELS,
} from '@/lib/infrastructure/assistant/provider-kinds';

describe('normalizeModelId', () => {
    it('lowercases and strips gateway prefixes and Ollama tags', () => {
        expect(normalizeModelId(' OpenAI/GPT-5.4-mini ')).toBe('gpt-5.4-mini');
        expect(normalizeModelId('anthropic/claude-sonnet-5-5')).toBe('claude-sonnet-5-5');
        expect(normalizeModelId('qwen3:8b')).toBe('qwen3');
        expect(normalizeModelId('library/gpt-oss:120b')).toBe('gpt-oss');
    });
});

describe('lookupModel', () => {
    it('finds exact ids', () => {
        expect(lookupModel('claude-opus-5-5')).toEqual({
            contextWindow: 1_000_000,
            pricing: { inputPerMTok: 4, outputPerMTok: 20, cachedInputPerMTok: 0.2 },
        });
        expect(lookupModel('gpt-5.4-mini')).toEqual({
            contextWindow: 400_000,
            pricing: { inputPerMTok: 0.75, outputPerMTok: 4.5, cachedInputPerMTok: 0.075 },
        });
    });

    it('finds ids behind a gateway prefix or with an Ollama tag', () => {
        expect(lookupModel('openai/gpt-5.4')?.contextWindow).toBe(1_050_000);
        expect(lookupModel('gpt-oss:20b')).toEqual({ contextWindow: 131_072 });
        expect(lookupModel('llama3.1:8b-instruct-q4_K_M')).toEqual({ contextWindow: 131_072 });
    });

    it('finds dated snapshots of a known model', () => {
        expect(lookupModel('gpt-5.4-2026-03-05')).toBe(lookupModel('gpt-5.4'));
        expect(lookupModel('gpt-5-mini-2025-08-07')).toBe(lookupModel('gpt-5-mini'));
        expect(lookupModel('claude-haiku-4-5-20251001')).toBe(lookupModel('claude-haiku-4-5'));
        expect(lookupModel('gpt-5.4-latest')).toBe(lookupModel('gpt-5.4'));
    });

    it('does not guess other variants of a known model', () => {
        expect(lookupModel('gpt-5-pro')).toBeUndefined();
        expect(lookupModel('qwen3-coder')).toBeUndefined();
    });

    it('returns undefined for unknown, empty or prototype ids', () => {
        expect(lookupModel('my-finetune')).toBeUndefined();
        expect(lookupModel('')).toBeUndefined();
        expect(lookupModel('constructor')).toBeUndefined();
        expect(lookupModel('__proto__')).toBeUndefined();
    });

    it('has sane entries', () => {
        expect(catalogModelIds().length).toBeGreaterThan(20);
        catalogModelIds().forEach(id => {
            const entry = lookupModel(id);
            expect(id).toBe(id.toLowerCase());
            expect(Number.isInteger(entry?.contextWindow)).toBe(true);
            expect(entry!.contextWindow!).toBeGreaterThan(0);
            if (entry?.pricing) {
                expect(entry.pricing.inputPerMTok).toBeGreaterThanOrEqual(0);
                expect(entry.pricing.outputPerMTok).toBeGreaterThanOrEqual(entry.pricing.inputPerMTok);
            }
        });
    });

    it('leaves open models unpriced', () => {
        expect(lookupModel('qwen3')?.pricing).toBeUndefined();
    });
});

describe('provider kinds', () => {
    it('describes every BYOK kind', () => {
        expect(Object.keys(PROVIDER_KIND_LABELS).sort()).toEqual([...BYOK_PROVIDER_KINDS].sort());
        expect(DEFAULT_BASE_URLS).toEqual({
            anthropic: 'https://api.anthropic.com',
            openai: 'https://api.openai.com/v1',
            'openai-compatible': undefined,
            ollama: 'http://localhost:11434',
        });
        expect(KIND_NEEDS_API_KEY).toEqual({ anthropic: true, openai: true, 'openai-compatible': false, ollama: false });
        expect(KIND_NEEDS_BASE_URL).toEqual({ anthropic: false, openai: false, 'openai-compatible': true, ollama: false });
        expect(ASSISTANT_RELAY_BASE_URL).toBe('/api/assistant/llm');
        expect(ANTHROPIC_API_VERSION).toBe('2023-06-01');
    });
});
