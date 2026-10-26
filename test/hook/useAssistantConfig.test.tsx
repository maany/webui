import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FeatureProvider } from '@/component-library/features/feature-flags/FeatureProvider';
import { FEATURE_REGISTRY, type FeatureFlagMap, type FeatureKey } from '@/lib/core/entity/feature-config';
import { DEFAULT_ASSISTANT_CONFIG } from '@/lib/core/entity/assistant/assistant-config';
import { useAssistantConfig } from '@/lib/infrastructure/hooks/useAssistantConfig';

const flags = (assistant: boolean): FeatureFlagMap => {
    const map = {} as FeatureFlagMap;
    (Object.keys(FEATURE_REGISTRY) as FeatureKey[]).forEach(key => {
        map[key] = false;
    });
    map.assistant = assistant;
    return map;
};

const wrapperFor = (assistant: boolean) =>
    function Wrapper({ children }: { children: React.ReactNode }) {
        const [client] = React.useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
        return (
            <QueryClientProvider client={client}>
                <FeatureProvider features={flags(assistant)}>{children}</FeatureProvider>
            </QueryClientProvider>
        );
    };

let fetchSpy: jest.Mock;
const reply = (status: number, body: unknown) => {
    fetchSpy = jest.fn(async () => ({ ok: status < 400, status, json: async () => body }));
    global.fetch = fetchSpy as unknown as typeof fetch;
};

describe('useAssistantConfig', () => {
    it('does not fetch while the assistant flag is off', () => {
        reply(200, {});
        const { result } = renderHook(() => useAssistantConfig(), { wrapper: wrapperFor(false) });
        expect(result.current.config).toEqual(DEFAULT_ASSISTANT_CONFIG);
        expect(result.current.isLoading).toBe(false);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('loads the operator config without the view model status', async () => {
        const defaultProvider = { kind: 'openai-compatible', model: 'gpt-oss-120b', label: 'CERN GPT-OSS' };
        reply(200, { status: 'success', ...DEFAULT_ASSISTANT_CONFIG, writePolicyCap: 'deny', allowByok: false, defaultProvider });
        const { result } = renderHook(() => useAssistantConfig(), { wrapper: wrapperFor(true) });
        expect(result.current.isLoading).toBe(true);
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(fetchSpy).toHaveBeenCalledWith('/api/feature/get-assistant-config');
        expect(result.current.config).toEqual({ ...DEFAULT_ASSISTANT_CONFIG, writePolicyCap: 'deny', allowByok: false, defaultProvider });
        expect(result.current.config).not.toHaveProperty('status');
        expect(result.current.error).toBeUndefined();
    });

    it('falls back to the defaults and reports the error', async () => {
        reply(500, { status: 'error', message: 'Could not read the assistant configuration', errorType: 'config_unavailable' });
        const { result } = renderHook(() => useAssistantConfig(), { wrapper: wrapperFor(true) });
        await waitFor(() => expect(result.current.error).toBeDefined());
        expect(result.current.error?.message).toBe('Could not read the assistant configuration');
        expect(result.current.config).toEqual(DEFAULT_ASSISTANT_CONFIG);
    });
});
