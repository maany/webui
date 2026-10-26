const mockProvider = {
    providerId: 'operator',
    kind: 'openai-compatible',
    model: 'fake-model',
    baseURL: '/api/assistant/llm',
    via: 'relay',
    contextWindow: 100_000,
};
const mockState: { config: object; isLoading: boolean; error?: Error; isReady: boolean; role: string } = {
    config: {},
    isLoading: false,
    isReady: true,
    role: 'admin',
};
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { rucioAccount: 'root', rucioVO: 'def', role: mockState.role } } }) }));
jest.mock('next/navigation', () => ({
    usePathname: () => '/rules',
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@/lib/infrastructure/hooks/usePermissions', () => ({ usePermissions: () => ({ isReady: mockState.isReady }) }));
jest.mock('@/lib/infrastructure/hooks/useAssistantConfig', () => ({
    useAssistantConfig: () => ({ config: mockState.config, isLoading: mockState.isLoading, error: mockState.error }),
}));
jest.mock('@/lib/core/services/assistant-provider', () => ({ resolveActiveProvider: () => mockProvider }));
jest.mock('@/lib/infrastructure/assistant/duckdb', () => ({ getAssistantDataHandleStore: jest.fn() }));

import React from 'react';
import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FeatureProvider } from '@/component-library/features/feature-flags/FeatureProvider';
import { AssistantProvider } from '@/component-library/features/assistant/AssistantProvider';
import { DEFAULT_ASSISTANT_CONFIG } from '@/lib/core/entity/assistant/assistant-config';
import { AssistantContext, type UseAssistantResult } from '@/lib/infrastructure/hooks/useAssistant';
import { AssistantShellProvider } from '@/lib/infrastructure/hooks/useAssistantShell';
import { InMemoryConversationRepository } from '@/lib/infrastructure/assistant/in-memory-conversation-repository';
import { getAssistantDataHandleStore } from '@/lib/infrastructure/assistant/duckdb';
import type { AgentRunner, AgentRunnerDeps, RunnerUpdate } from '@/lib/infrastructure/assistant/tanstack-agent-runner';
import { FEATURE_REGISTRY, type FeatureFlagMap, type FeatureKey } from '@/lib/core/entity/feature-config';
import { makeNoopHandles } from 'test/fixtures/assistant-fixtures';

const flagsWith = (overrides: Partial<Record<FeatureKey, boolean>> = {}): FeatureFlagMap => {
    const map = {} as FeatureFlagMap;
    (Object.keys(FEATURE_REGISTRY) as FeatureKey[]).forEach(key => {
        map[key] = overrides[key] ?? true;
    });
    return map;
};

function setup() {
    (getAssistantDataHandleStore as jest.Mock).mockReturnValue(makeNoopHandles());
    const runnerDeps: Array<() => AgentRunnerDeps> = [];
    const createRunner = (deps: () => AgentRunnerDeps): AgentRunner => {
        runnerDeps.push(deps);
        return {
            run: async function* () {
                yield { type: 'finished', status: 'completed' } as RunnerUpdate;
            },
            resolveApproval: jest.fn(),
        };
    };
    let current!: UseAssistantResult;
    const Probe = () => {
        current = React.useContext(AssistantContext) as UseAssistantResult;
        return null;
    };
    const tree = (features: FeatureFlagMap) => (
        <QueryClientProvider client={new QueryClient()}>
            <FeatureProvider features={features}>
                <AssistantShellProvider>
                    <AssistantProvider
                        overrides={{
                            repository: Promise.resolve({ repository: new InMemoryConversationRepository(), persistent: true }),
                            createRunner,
                        }}
                    >
                        <Probe />
                    </AssistantProvider>
                </AssistantShellProvider>
            </FeatureProvider>
        </QueryClientProvider>
    );
    return { runnerDeps, tree, assistant: () => current };
}

async function startTurn(flags: FeatureFlagMap) {
    const { runnerDeps, tree, assistant } = setup();
    const view = render(tree(flags));
    await act(async () => {
        await assistant().send('hello');
    });
    return { policyFor: runnerDeps[0]().policyFor, view, tree };
}

describe('AssistantProvider live policy for writes', () => {
    beforeEach(() => {
        localStorage.clear();
        mockState.config = DEFAULT_ASSISTANT_CONFIG;
        mockState.isLoading = false;
        mockState.error = undefined;
        mockState.isReady = true;
        mockState.role = 'admin';
    });

    it('denies a write tool while the operator config is loading, whatever the default config says', async () => {
        mockState.isLoading = true;
        const { policyFor } = await startTurn(flagsWith());
        expect(policyFor('create_rule')).toBe('deny');
    });

    it('denies a write tool when the operator config failed to load', async () => {
        mockState.error = new Error('down');
        const { policyFor } = await startTurn(flagsWith());
        expect(policyFor('create_rule')).toBe('deny');
    });

    it('asks for a write tool once the config is loaded with the ask cap', async () => {
        const { policyFor } = await startTurn(flagsWith());
        expect(policyFor('create_rule')).toBe('ask');
        expect(policyFor('list_rules')).toBe('allow');
    });

    it('denies write tools when assistant.write is off', async () => {
        const { policyFor } = await startTurn(flagsWith({ 'assistant.write': false }));
        expect(policyFor('create_rule')).toBe('deny');
        expect(policyFor('list_rules')).toBe('allow');
    });

    it('sees changes made after the turn started: config loading, flags and permissions readiness', async () => {
        const { policyFor, view, tree } = await startTurn(flagsWith());
        expect(policyFor('create_rule')).toBe('ask');

        mockState.isLoading = true;
        view.rerender(tree(flagsWith()));
        expect(policyFor('create_rule')).toBe('deny');

        mockState.isLoading = false;
        view.rerender(tree(flagsWith()));
        expect(policyFor('create_rule')).toBe('ask');

        view.rerender(tree(flagsWith({ 'assistant.write': false })));
        expect(policyFor('create_rule')).toBe('deny');

        view.rerender(tree(flagsWith()));
        mockState.isReady = false;
        view.rerender(tree(flagsWith()));
        expect(policyFor('create_rule')).toBe('deny');
    });
});
