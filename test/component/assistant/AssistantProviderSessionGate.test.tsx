jest.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { rucioAccount: 'root', rucioVO: 'def', role: 'admin' } } }) }));
jest.mock('next/navigation', () => ({
    usePathname: () => '/rules',
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@/lib/infrastructure/hooks/usePermissions', () => ({ usePermissions: () => ({ isReady: true }) }));
jest.mock('@/lib/infrastructure/hooks/useAssistantConfig', () => ({
    useAssistantConfig: () => ({ config: require('@/lib/core/entity/assistant/assistant-config').DEFAULT_ASSISTANT_CONFIG }),
}));
jest.mock('@/lib/core/services/assistant-provider', () => ({
    resolveActiveProvider: () => ({
        providerId: 'operator',
        kind: 'openai-compatible',
        model: 'm',
        baseURL: '/x',
        via: 'relay',
        contextWindow: 100_000,
    }),
}));
jest.mock('@/lib/infrastructure/assistant/duckdb', () => ({ getAssistantDataHandleStore: jest.fn() }));

import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FeatureProvider } from '@/component-library/features/feature-flags/FeatureProvider';
import { AssistantProvider } from '@/component-library/features/assistant/AssistantProvider';
import { AssistantContext, type UseAssistantResult } from '@/lib/infrastructure/hooks/useAssistant';
import { AssistantShellProvider } from '@/lib/infrastructure/hooks/useAssistantShell';
import { SessionGateContext, type SessionGateStatus } from '@/lib/infrastructure/auth/session-gate';
import { InMemoryConversationRepository } from '@/lib/infrastructure/assistant/in-memory-conversation-repository';
import { getAssistantDataHandleStore } from '@/lib/infrastructure/assistant/duckdb';
import type { AgentRunner, RunnerUpdate } from '@/lib/infrastructure/assistant/tanstack-agent-runner';
import { FEATURE_REGISTRY, type FeatureFlagMap, type FeatureKey } from '@/lib/core/entity/feature-config';
import { makeNoopHandles } from 'test/fixtures/assistant-fixtures';

const allFlags = (): FeatureFlagMap => {
    const map = {} as FeatureFlagMap;
    (Object.keys(FEATURE_REGISTRY) as FeatureKey[]).forEach(key => {
        map[key] = true;
    });
    return map;
};

describe('AssistantProvider session gate', () => {
    beforeEach(() => localStorage.clear());

    it('stops a turn awaiting approval and expires the approval when the gate leaves active', async () => {
        (getAssistantDataHandleStore as jest.Mock).mockReturnValue(makeNoopHandles());
        const repository = new InMemoryConversationRepository();
        const aborted = jest.fn();
        const runner: AgentRunner = {
            async *run(input): AsyncGenerator<RunnerUpdate> {
                yield { type: 'tool-call', toolCallId: 'call-1', toolName: 'create_rule', args: {}, policy: 'ask' };
                yield { type: 'approval-required', toolCallId: 'call-1' };
                await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve()));
                aborted();
                yield { type: 'finished', status: 'stopped' };
            },
            resolveApproval: jest.fn(),
        };
        let current!: UseAssistantResult;
        const Probe = () => {
            current = React.useContext(AssistantContext) as UseAssistantResult;
            return null;
        };
        const tree = (status: SessionGateStatus) => (
            <SessionGateContext.Provider value={{ status }}>
                <QueryClientProvider client={new QueryClient()}>
                    <FeatureProvider features={allFlags()}>
                        <AssistantShellProvider>
                            <AssistantProvider
                                overrides={{ repository: Promise.resolve({ repository, persistent: true }), createRunner: () => runner }}
                            >
                                <Probe />
                            </AssistantProvider>
                        </AssistantShellProvider>
                    </FeatureProvider>
                </QueryClientProvider>
            </SessionGateContext.Provider>
        );
        const view = render(tree('active'));
        act(() => {
            void current.send('make a rule');
        });
        await waitFor(() => expect(current.status).toBe('awaiting-approval'));
        view.rerender(tree('reauth-required'));
        await waitFor(() => expect(aborted).toHaveBeenCalled());
        await waitFor(() => expect(current.pendingApprovals).toHaveLength(0));
        expect(current.status).not.toBe('awaiting-approval');
        await act(async () => {
            await current.send('still there?');
        });
        expect(current.messages.filter(message => message.role === 'user')).toHaveLength(1);
    });
});
