import type { AssistantConfig } from '@/lib/core/entity/assistant/assistant-config';
import type { ModelPricing, ResolvedProvider } from '@/lib/core/entity/assistant/provider-config';
import type { AssistantSettings } from '@/lib/core/entity/assistant/settings';

export type ResolveProviderError = 'no-provider' | 'byok-disabled' | 'kind-not-allowed';

type ModelCatalogLookup = (model: string) => { contextWindow?: number; pricing?: ModelPricing } | undefined;

/**
 * The provider the runner should use. Pure: call it on every turn so operator changes apply at once.
 * Context window: provider (or operator) value > catalog.
 * Pricing: config.pricesOverride[model] > provider.pricing > catalog.
 * BYOK baseURL stays undefined when the user left it empty (adapter default).
 */
export function resolveActiveProvider(
    settings: AssistantSettings,
    config: AssistantConfig,
    relayBaseURL: string,
    modelCatalog: ModelCatalogLookup,
): ResolvedProvider | { error: ResolveProviderError } {
    if (settings.activeProviderId === 'operator') {
        const operator = config.defaultProvider;
        if (!operator) return { error: 'no-provider' };
        const known = modelCatalog(operator.model);
        const contextWindow = operator.contextWindow ?? known?.contextWindow;
        const pricing = config.pricesOverride?.[operator.model] ?? known?.pricing;
        return {
            providerId: 'operator',
            kind: operator.kind,
            model: operator.model,
            baseURL: relayBaseURL,
            via: 'relay',
            ...(contextWindow !== undefined ? { contextWindow } : {}),
            ...(pricing ? { pricing } : {}),
        };
    }

    const provider = settings.providers.find(candidate => candidate.id === settings.activeProviderId);
    if (!provider) return { error: 'no-provider' };
    if (!config.allowByok) return { error: 'byok-disabled' };
    if (!config.allowedProviderKinds.includes(provider.kind)) return { error: 'kind-not-allowed' };

    const known = modelCatalog(provider.model);
    const contextWindow = provider.contextWindow ?? known?.contextWindow;
    const pricing = config.pricesOverride?.[provider.model] ?? provider.pricing ?? known?.pricing;
    return {
        providerId: provider.id,
        kind: provider.kind,
        model: provider.model,
        ...(provider.baseURL ? { baseURL: provider.baseURL } : {}),
        ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
        via: 'direct',
        ...(contextWindow !== undefined ? { contextWindow } : {}),
        ...(pricing ? { pricing } : {}),
    };
}
