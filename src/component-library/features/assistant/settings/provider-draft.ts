import type { ByokProviderKind, ProviderConfig } from '@/lib/core/entity/assistant/provider-config';
import { lookupModel } from '@/lib/infrastructure/assistant/model-catalog';
import { KIND_NEEDS_API_KEY, KIND_NEEDS_BASE_URL } from '@/lib/infrastructure/assistant/provider-kinds';

/** Form state of the provider dialog: every field is the raw text the user typed. */
export interface ProviderDraft {
    kind: ByokProviderKind;
    label: string;
    baseURL: string;
    apiKey: string;
    model: string;
    contextWindow: string;
    inputPerMTok: string;
    outputPerMTok: string;
}

export type ProviderDraftErrors = Partial<Record<keyof ProviderDraft, string>>;

type ContextWindowLookup = (model: string) => { contextWindow?: number } | undefined;

const PRICE = /^\d+(\.\d+)?$/;
const WHOLE_NUMBER = /^\d+$/;

export function emptyProviderDraft(kind: ByokProviderKind): ProviderDraft {
    return { kind, label: '', baseURL: '', apiKey: '', model: '', contextWindow: '', inputPerMTok: '', outputPerMTok: '' };
}

export function draftFromProvider(provider: ProviderConfig): ProviderDraft {
    return {
        kind: provider.kind,
        label: provider.label,
        baseURL: provider.baseURL ?? '',
        apiKey: provider.apiKey ?? '',
        model: provider.model,
        contextWindow: provider.contextWindow !== undefined ? String(provider.contextWindow) : '',
        inputPerMTok: provider.pricing ? String(provider.pricing.inputPerMTok) : '',
        outputPerMTok: provider.pricing ? String(provider.pricing.outputPerMTok) : '',
    };
}

function isHttpUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

export function validateProviderDraft(draft: ProviderDraft, lookup: ContextWindowLookup = lookupModel): ProviderDraftErrors {
    const errors: ProviderDraftErrors = {};
    const label = draft.label.trim();
    const model = draft.model.trim();
    const baseURL = draft.baseURL.trim();
    const apiKey = draft.apiKey.trim();
    const contextWindow = draft.contextWindow.trim();
    const input = draft.inputPerMTok.trim();
    const output = draft.outputPerMTok.trim();

    if (!label) errors.label = 'Enter a name for this provider.';
    if (!model) errors.model = 'Enter a model id.';
    if (baseURL) {
        if (!isHttpUrl(baseURL)) errors.baseURL = 'Enter a full URL that starts with http:// or https://.';
    } else if (KIND_NEEDS_BASE_URL[draft.kind]) {
        errors.baseURL = 'This provider type needs a base URL.';
    }
    if (!apiKey && KIND_NEEDS_API_KEY[draft.kind]) errors.apiKey = 'This provider type needs an API key.';
    if (contextWindow) {
        if (!WHOLE_NUMBER.test(contextWindow) || Number(contextWindow) <= 0) errors.contextWindow = 'Enter a whole number of tokens.';
    } else if (model && !lookup(model)?.contextWindow) {
        errors.contextWindow = 'Unknown model. Enter its context window in tokens.';
    }
    if (input || output) {
        if (!PRICE.test(input)) errors.inputPerMTok = 'Enter a price in USD, for example 3 or 0.25.';
        if (!PRICE.test(output)) errors.outputPerMTok = 'Enter a price in USD, for example 15 or 1.25.';
    }
    return errors;
}

/** Converts a valid draft (see validateProviderDraft) into a stored provider. */
export function providerFromDraft(draft: ProviderDraft, id: string): ProviderConfig {
    const provider: ProviderConfig = { id, kind: draft.kind, label: draft.label.trim(), model: draft.model.trim() };
    const baseURL = draft.baseURL.trim().replace(/\/+$/, '');
    const apiKey = draft.apiKey.trim();
    const contextWindow = draft.contextWindow.trim();
    const input = draft.inputPerMTok.trim();
    const output = draft.outputPerMTok.trim();
    if (baseURL) provider.baseURL = baseURL;
    if (apiKey) provider.apiKey = apiKey;
    if (contextWindow) provider.contextWindow = Number(contextWindow);
    if (input && output) provider.pricing = { inputPerMTok: Number(input), outputPerMTok: Number(output) };
    return provider;
}
