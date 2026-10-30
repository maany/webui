import type { ByokProviderKind } from '@/lib/core/entity/assistant/provider-config';

/** Same-origin operator relay; the 'operator' provider's baseURL. */
export const ASSISTANT_RELAY_BASE_URL = '/api/assistant/llm';

export const PROVIDER_KIND_LABELS: Record<ByokProviderKind, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    'openai-compatible': 'OpenAI-compatible',
    ollama: 'Ollama',
};

export const PROVIDER_KIND_DESCRIPTIONS: Record<ByokProviderKind, string> = {
    anthropic: 'Claude models, called from your browser.',
    openai: 'GPT models, called from your browser.',
    'openai-compatible': 'LiteLLM, vLLM or another gateway.',
    ollama: 'Models running on your computer or network.',
};

/** Defaults used when a provider has no base URL. openai-compatible always needs one. */
export const DEFAULT_BASE_URLS: Record<ByokProviderKind, string | undefined> = {
    anthropic: 'https://api.anthropic.com',
    openai: 'https://api.openai.com/v1',
    'openai-compatible': undefined,
    ollama: 'http://localhost:11434',
};

export const KIND_NEEDS_API_KEY: Record<ByokProviderKind, boolean> = {
    anthropic: true,
    openai: true,
    'openai-compatible': false,
    ollama: false,
};

export const KIND_NEEDS_BASE_URL: Record<ByokProviderKind, boolean> = {
    anthropic: false,
    openai: false,
    'openai-compatible': true,
    ollama: false,
};

/** Value of the `anthropic-version` header sent to the Anthropic API. */
export const ANTHROPIC_API_VERSION = '2023-06-01';

/** User prompt of the settings "Test connection" request; the relay does not topic-check it. */
export const CONNECTION_TEST_PROMPT = 'Reply with OK.';
