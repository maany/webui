export const BYOK_PROVIDER_KINDS = ['anthropic', 'openai', 'openai-compatible', 'ollama'] as const;
export type ByokProviderKind = (typeof BYOK_PROVIDER_KINDS)[number];
export type ProviderKind = 'operator' | ByokProviderKind;

export interface ModelPricing {
    inputPerMTok: number; // USD per million input tokens
    outputPerMTok: number;
    cachedInputPerMTok?: number;
}

export interface ProviderConfig {
    id: string; // uuid
    kind: ByokProviderKind;
    label: string;
    baseURL?: string;
    apiKey?: string;
    model: string;
    contextWindow?: number;
    pricing?: ModelPricing;
}

export interface OperatorProviderInfo {
    kind: 'openai-compatible' | 'anthropic';
    model: string;
    label: string;
    contextWindow?: number;
}

/** Output of resolveActiveProvider; what the runner builds an adapter from. */
export interface ResolvedProvider {
    providerId: string | 'operator';
    kind: 'anthropic' | 'openai' | 'openai-compatible' | 'ollama';
    model: string;
    baseURL?: string; // for 'operator' this is the same-origin relay URL
    apiKey?: string; // undefined for 'operator' (relay injects it)
    via: 'direct' | 'relay';
    contextWindow?: number;
    pricing?: ModelPricing;
}
