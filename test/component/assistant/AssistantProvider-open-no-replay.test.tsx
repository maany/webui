const mockPush = jest.fn();
afterEach(() => mockPush.mockClear());
const mockProvider = {
    providerId: 'operator',
    kind: 'openai-compatible',
    model: 'fake-model',
    baseURL: '/api/assistant/llm',
    via: 'relay',
    contextWindow: 100_000,
};
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { rucioAccount: 'root', rucioVO: 'def', role: 'admin' } } }) }));
jest.mock('next/navigation', () => ({
    usePathname: () => '/dashboard',
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ push: mockPush }),
}));
jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ href, children, prefetch, ...rest }: any) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));
jest.mock('@/lib/infrastructure/hooks/usePermissions', () => ({ usePermissions: () => ({ isReady: true }) }));
jest.mock('@/lib/infrastructure/hooks/useAssistantConfig', () => ({
    useAssistantConfig: () => ({ config: require('@/lib/core/entity/assistant/assistant-config').DEFAULT_ASSISTANT_CONFIG }),
}));
jest.mock('@/lib/core/services/assistant-provider', () => ({ resolveActiveProvider: () => mockProvider }));
jest.mock('@/lib/infrastructure/assistant/duckdb', () => ({ getAssistantDataHandleStore: jest.fn() }));

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FeatureProvider } from '@/component-library/features/feature-flags/FeatureProvider';
import { AssistantProvider } from '@/component-library/features/assistant/AssistantProvider';
import { AssistantPanel } from '@/component-library/features/assistant/AssistantPanel';
import { AssistantContext, type UseAssistantResult } from '@/lib/infrastructure/hooks/useAssistant';
import { AssistantShellProvider, useAssistantPanel } from '@/lib/infrastructure/hooks/useAssistantShell';
import { InMemoryConversationRepository } from '@/lib/infrastructure/assistant/in-memory-conversation-repository';
import { getAssistantDataHandleStore } from '@/lib/infrastructure/assistant/duckdb';
import { FEATURE_REGISTRY, type FeatureFlagMap, type FeatureKey } from '@/lib/core/entity/feature-config';
import { fakeText } from '@tanstack/ai/testing';
import { createAgentRunner } from '@/lib/infrastructure/assistant/tanstack-agent-runner';
import { makeConversation, makeNoopHandles, makeUserMessage } from 'test/fixtures/assistant-fixtures';

const allFlags = (): FeatureFlagMap => {
    const m = {} as FeatureFlagMap;
    (Object.keys(FEATURE_REGISTRY) as FeatureKey[]).forEach(k => {
        m[k] = true;
    });
    return m;
};

it('opening a stored chat whose last tool call was navigate runs nothing, navigates nowhere and keeps the panel open', async () => {
    window.matchMedia = jest
        .fn()
        .mockImplementation((q: string) => ({ matches: false, media: q, addEventListener: jest.fn(), removeEventListener: jest.fn() }));
    const repository = new InMemoryConversationRepository();
    await repository.saveConversation({ ...makeConversation('c1', 'root@def'), title: 'Old chat' });
    await repository.saveMessage(makeUserMessage('show rules', 'c1'));
    await repository.saveMessage({
        id: 'a1',
        conversationId: 'c1',
        role: 'assistant',
        createdAt: '2026-10-25T10:00:01.000Z',
        parts: [
            {
                type: 'tool-call',
                toolCallId: 'call_nav1',
                toolName: 'navigate',
                args: { page: 'rules' },
                policy: 'allow',
                status: 'done',
                result: { url: '/rules', navigated: true, actions: [] },
            },
            { type: 'text', text: 'Opened rules.' },
        ],
    });
    (getAssistantDataHandleStore as jest.Mock).mockReturnValue(makeNoopHandles());
    const fake = fakeText();
    fake.setResponses([{ text: 'sure' }]);
    const createRunner = jest.fn((d: any) => createAgentRunner(d, { createAdapter: () => fake }));
    let current!: UseAssistantResult;
    let shell!: ReturnType<typeof useAssistantPanel>;
    const Probe = () => {
        current = React.useContext(AssistantContext) as UseAssistantResult;
        shell = useAssistantPanel();
        return <span data-testid="state">{shell.panelState}</span>;
    };
    render(
        <QueryClientProvider client={new QueryClient()}>
            <FeatureProvider features={allFlags()}>
                <AssistantShellProvider>
                    <AssistantProvider
                        overrides={{ repository: Promise.resolve({ repository, persistent: true }), createRunner: createRunner as any }}
                    >
                        <Probe />
                        <AssistantPanel />
                    </AssistantProvider>
                </AssistantShellProvider>
            </FeatureProvider>
        </QueryClientProvider>,
    );
    act(() => shell.toggle());
    await waitFor(() => expect(current.conversations.length).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: 'Chat history' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Old chat' }));
    await waitFor(() => expect(current.messages.length).toBe(2));
    await new Promise(r => setTimeout(r, 200));
    expect(mockPush).toHaveBeenCalledTimes(0);
    expect(createRunner).toHaveBeenCalledTimes(0);
    expect(shell.panelState).toBe('open');
    await act(async () => {
        await current.send('thanks');
    });
    await new Promise(r => setTimeout(r, 200));
    expect(mockPush).toHaveBeenCalledTimes(0);
    expect(shell.panelState).toBe('open');
});
