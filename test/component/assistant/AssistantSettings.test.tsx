import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FeatureProvider } from '@/component-library/features/feature-flags/FeatureProvider';
import { AssistantSettings } from '@/component-library/features/assistant/settings/AssistantSettings';
import { FEATURE_REGISTRY, type FeatureFlagMap, type FeatureKey } from '@/lib/core/entity/feature-config';
import { DEFAULT_ASSISTANT_CONFIG } from '@/lib/core/entity/assistant/assistant-config';
import { ASSISTANT_SETTINGS_KEY, getDefaultAssistantSettings } from '@/lib/infrastructure/assistant/settings-storage';

const flags = (): FeatureFlagMap => {
    const map = {} as FeatureFlagMap;
    (Object.keys(FEATURE_REGISTRY) as FeatureKey[]).forEach(key => {
        map[key] = false;
    });
    map.assistant = true;
    return map;
};

describe('AssistantSettings', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    it('loads the operator config and the saved settings', async () => {
        localStorage.setItem(
            ASSISTANT_SETTINGS_KEY,
            JSON.stringify({ ...getDefaultAssistantSettings(), providers: [{ id: 'p-1', kind: 'ollama', label: 'Local Qwen', model: 'qwen3' }] }),
        );
        const fetchSpy = jest.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                status: 'success',
                ...DEFAULT_ASSISTANT_CONFIG,
                defaultProvider: { kind: 'openai-compatible', model: 'gpt-oss-120b', label: 'CERN GPT-OSS' },
            }),
        }));
        global.fetch = fetchSpy as unknown as typeof fetch;
        render(
            <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
                <FeatureProvider features={flags()}>
                    <AssistantSettings />
                </FeatureProvider>
            </QueryClientProvider>,
        );
        expect(await screen.findByText('CERN GPT-OSS')).toBeInTheDocument();
        expect(screen.getByText('Local Qwen')).toBeInTheDocument();
        expect(fetchSpy).toHaveBeenCalledWith('/api/feature/get-assistant-config');
    });
});
