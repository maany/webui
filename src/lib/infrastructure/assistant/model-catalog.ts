import type { ModelPricing } from '@/lib/core/entity/assistant/provider-config';

export interface ModelCatalogEntry {
    contextWindow?: number;
    pricing?: ModelPricing;
}

/*
 * Bundled context windows and list prices (USD per million tokens, standard tier), checked 2026-10-25.
 * Sources:
 * - Anthropic models and prices: https://platform.claude.com/docs/en/about-claude/models/overview and
 *   https://platform.claude.com/docs/en/about-claude/pricing (cache reads listed as cachedInputPerMTok).
 * - OpenAI prices: https://developers.openai.com/api/docs/pricing ; context windows from the model pages
 *   under https://developers.openai.com/api/docs/models (gpt-5.5 and gpt-5.4: 1,050,000; gpt-5.4-mini: 400,000).
 * - Open models: native context length from https://ollama.com/library (Ollama's default num_ctx is smaller
 *   unless the server raises it). They run on the user's or operator's hardware, so no price is listed.
 * Operators override prices with ASSISTANT_PRICES_JSON; users can set prices per provider.
 */
const MODEL_CATALOG: Record<string, ModelCatalogEntry> = {
    // Anthropic
    'claude-fable-5-1': { contextWindow: 1_000_000, pricing: { inputPerMTok: 10, outputPerMTok: 50, cachedInputPerMTok: 0.25 } },
    'claude-fable-5': { contextWindow: 1_000_000, pricing: { inputPerMTok: 10, outputPerMTok: 50, cachedInputPerMTok: 1 } },
    'claude-opus-5-5': { contextWindow: 1_000_000, pricing: { inputPerMTok: 4, outputPerMTok: 20, cachedInputPerMTok: 0.2 } },
    'claude-opus-5': { contextWindow: 1_000_000, pricing: { inputPerMTok: 5, outputPerMTok: 25, cachedInputPerMTok: 0.5 } },
    'claude-opus-4-8': { contextWindow: 1_000_000, pricing: { inputPerMTok: 5, outputPerMTok: 25, cachedInputPerMTok: 0.5 } },
    'claude-opus-4-7': { contextWindow: 1_000_000, pricing: { inputPerMTok: 5, outputPerMTok: 25, cachedInputPerMTok: 0.5 } },
    'claude-opus-4-6': { contextWindow: 1_000_000, pricing: { inputPerMTok: 5, outputPerMTok: 25, cachedInputPerMTok: 0.5 } },
    'claude-sonnet-5-5': { contextWindow: 1_000_000, pricing: { inputPerMTok: 2, outputPerMTok: 10, cachedInputPerMTok: 0.2 } },
    'claude-sonnet-5': { contextWindow: 1_000_000, pricing: { inputPerMTok: 2, outputPerMTok: 10, cachedInputPerMTok: 0.2 } },
    'claude-sonnet-4-6': { contextWindow: 1_000_000, pricing: { inputPerMTok: 3, outputPerMTok: 15, cachedInputPerMTok: 0.3 } },
    'claude-haiku-4-5': { contextWindow: 200_000, pricing: { inputPerMTok: 1, outputPerMTok: 5, cachedInputPerMTok: 0.1 } },
    // OpenAI (chat completions models; the -pro models are Responses-only and not listed)
    'gpt-5.5': { contextWindow: 1_050_000, pricing: { inputPerMTok: 5, outputPerMTok: 30, cachedInputPerMTok: 0.5 } },
    'gpt-5.4': { contextWindow: 1_050_000, pricing: { inputPerMTok: 2.5, outputPerMTok: 15, cachedInputPerMTok: 0.25 } },
    'gpt-5.4-mini': { contextWindow: 400_000, pricing: { inputPerMTok: 0.75, outputPerMTok: 4.5, cachedInputPerMTok: 0.075 } },
    'gpt-5.4-nano': { contextWindow: 400_000, pricing: { inputPerMTok: 0.2, outputPerMTok: 1.25, cachedInputPerMTok: 0.02 } },
    'gpt-5.2': { contextWindow: 400_000, pricing: { inputPerMTok: 1.75, outputPerMTok: 14, cachedInputPerMTok: 0.175 } },
    'gpt-5.1': { contextWindow: 400_000, pricing: { inputPerMTok: 1.25, outputPerMTok: 10, cachedInputPerMTok: 0.125 } },
    'gpt-5': { contextWindow: 400_000, pricing: { inputPerMTok: 1.25, outputPerMTok: 10, cachedInputPerMTok: 0.125 } },
    'gpt-5-mini': { contextWindow: 400_000, pricing: { inputPerMTok: 0.25, outputPerMTok: 2, cachedInputPerMTok: 0.025 } },
    'gpt-5-nano': { contextWindow: 400_000, pricing: { inputPerMTok: 0.05, outputPerMTok: 0.4, cachedInputPerMTok: 0.005 } },
    'gpt-4.1': { contextWindow: 1_047_576, pricing: { inputPerMTok: 2, outputPerMTok: 8, cachedInputPerMTok: 0.5 } },
    'gpt-4.1-mini': { contextWindow: 1_047_576, pricing: { inputPerMTok: 0.4, outputPerMTok: 1.6, cachedInputPerMTok: 0.1 } },
    'gpt-4.1-nano': { contextWindow: 1_047_576, pricing: { inputPerMTok: 0.1, outputPerMTok: 0.4, cachedInputPerMTok: 0.025 } },
    o3: { contextWindow: 200_000, pricing: { inputPerMTok: 2, outputPerMTok: 8, cachedInputPerMTok: 0.5 } },
    'o4-mini': { contextWindow: 200_000, pricing: { inputPerMTok: 1.1, outputPerMTok: 4.4, cachedInputPerMTok: 0.275 } },
    // Open models with tool support (Ollama, vLLM, LiteLLM)
    'gpt-oss': { contextWindow: 131_072 },
    'gpt-oss-20b': { contextWindow: 131_072 },
    'gpt-oss-120b': { contextWindow: 131_072 },
    qwen3: { contextWindow: 40_960 },
    'qwen2.5': { contextWindow: 32_768 },
    'llama3.1': { contextWindow: 131_072 },
    'llama3.3': { contextWindow: 131_072 },
    'mistral-small3.2': { contextWindow: 131_072 },
};

const SNAPSHOT_SUFFIX = /^(\d{4}-\d{2}-\d{2}|\d{8}|latest)$/;

function catalogEntry(id: string): ModelCatalogEntry | undefined {
    return Object.prototype.hasOwnProperty.call(MODEL_CATALOG, id) ? MODEL_CATALOG[id] : undefined;
}

/** Lowercase, without a gateway prefix ('openai/', 'anthropic/') and without an Ollama tag (':8b'). */
export function normalizeModelId(model: string): string {
    let id = model.trim().toLowerCase();
    const slash = id.lastIndexOf('/');
    if (slash >= 0) id = id.slice(slash + 1);
    const colon = id.indexOf(':');
    if (colon >= 0) id = id.slice(0, colon);
    return id;
}

/** Context window and price for a model id, or undefined when unknown. Dated snapshots resolve to their base model. */
export function lookupModel(model: string): ModelCatalogEntry | undefined {
    const id = normalizeModelId(model);
    if (!id) return undefined;
    const exact = catalogEntry(id);
    if (exact) return exact;
    let best: string | undefined;
    Object.keys(MODEL_CATALOG).forEach(key => {
        if (id.startsWith(`${key}-`) && SNAPSHOT_SUFFIX.test(id.slice(key.length + 1)) && (!best || key.length > best.length)) {
            best = key;
        }
    });
    return best ? catalogEntry(best) : undefined;
}

export function catalogModelIds(): string[] {
    return Object.keys(MODEL_CATALOG);
}
