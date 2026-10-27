'use client';

import { useQuery } from '@tanstack/react-query';
import { useFeature } from '@/component-library/features/feature-flags/FeatureProvider';
import { DEFAULT_ASSISTANT_CONFIG, type AssistantConfig } from '@/lib/core/entity/assistant/assistant-config';
import type { AssistantConfigViewModel } from '@/lib/infrastructure/data/view-model/assistant-config';
import { QUERY_KEYS } from '@/lib/infrastructure/query/query-keys';

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/** Fetches the operator config and strips the view model envelope. Throws on any failure. */
export async function fetchAssistantConfig(): Promise<AssistantConfig> {
    const response = await fetch('/api/feature/get-assistant-config');
    let viewModel: AssistantConfigViewModel | undefined;
    try {
        viewModel = (await response.json()) as AssistantConfigViewModel;
    } catch {
        viewModel = undefined;
    }
    if (!response.ok || !viewModel || viewModel.status !== 'success') {
        throw new Error(viewModel?.message ?? `Assistant configuration request failed with HTTP ${response.status}`);
    }
    const config: AssistantConfig = {
        writePolicyCap: viewModel.writePolicyCap ?? DEFAULT_ASSISTANT_CONFIG.writePolicyCap,
        highRiskPolicyCap: viewModel.highRiskPolicyCap ?? DEFAULT_ASSISTANT_CONFIG.highRiskPolicyCap,
        allowByok: viewModel.allowByok ?? DEFAULT_ASSISTANT_CONFIG.allowByok,
        allowedProviderKinds: viewModel.allowedProviderKinds ?? DEFAULT_ASSISTANT_CONFIG.allowedProviderKinds,
        telemetry: viewModel.telemetry ?? DEFAULT_ASSISTANT_CONFIG.telemetry,
        operatorSkills: viewModel.operatorSkills ?? DEFAULT_ASSISTANT_CONFIG.operatorSkills,
    };
    if (viewModel.defaultProvider) config.defaultProvider = viewModel.defaultProvider;
    if (viewModel.pricesOverride) config.pricesOverride = viewModel.pricesOverride;
    if (typeof viewModel.maxToolCallsPerTurn === 'number') config.maxToolCallsPerTurn = viewModel.maxToolCallsPerTurn;
    return config;
}

/**
 * Operator configuration for Rucio bot. Returns DEFAULT_ASSISTANT_CONFIG while loading, on error,
 * and while the assistant flag is off (no request is made then). isLoaded is true only once real data arrived.
 */
export function useAssistantConfig(): { config: AssistantConfig; isLoading: boolean; isLoaded: boolean; error?: Error } {
    const enabled = useFeature('assistant');
    const query = useQuery<AssistantConfig, Error>({
        queryKey: QUERY_KEYS.assistantConfig,
        queryFn: fetchAssistantConfig,
        enabled,
        staleTime: FIVE_MINUTES_MS,
        retry: false,
        refetchOnWindowFocus: false,
    });
    return {
        config: query.data ?? DEFAULT_ASSISTANT_CONFIG,
        isLoading: enabled && query.isLoading,
        // False for a query that is disabled, errored or paused offline (not loading, no data): callers fail closed.
        isLoaded: enabled && query.data !== undefined,
        ...(query.error ? { error: query.error } : {}),
    };
}
