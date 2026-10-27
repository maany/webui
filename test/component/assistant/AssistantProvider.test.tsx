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
    usePathname: () => '/rules',
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@/lib/infrastructure/hooks/usePermissions', () => ({ usePermissions: () => ({ isReady: true }) }));
jest.mock('@/lib/infrastructure/hooks/useAssistantConfig', () => ({
    useAssistantConfig: () => ({ config: require('@/lib/core/entity/assistant/assistant-config').DEFAULT_ASSISTANT_CONFIG }),
}));
jest.mock('@/lib/core/services/assistant-provider', () => ({ resolveActiveProvider: () => mockProvider }));
jest.mock('@/lib/infrastructure/assistant/duckdb', () => ({ getAssistantDataHandleStore: jest.fn() }));

import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FeatureProvider } from '@/component-library/features/feature-flags/FeatureProvider';
import { AssistantProvider } from '@/component-library/features/assistant/AssistantProvider';
import { useRefreshGate } from '@/component-library/features/assistant/DataHandleStoreContext';
import { AssistantContext, type UseAssistantResult } from '@/lib/infrastructure/hooks/useAssistant';
import { AssistantShellProvider, useAssistantPanel, type AssistantConversationControls } from '@/lib/infrastructure/hooks/useAssistantShell';
import { InMemoryConversationRepository } from '@/lib/infrastructure/assistant/in-memory-conversation-repository';
import { getAssistantDataHandleStore } from '@/lib/infrastructure/assistant/duckdb';
import { OFF_TOPIC_ERROR } from '@/lib/infrastructure/assistant/runner-errors';
import type { AgentRunner, AgentRunnerDeps, RunnerUpdate } from '@/lib/infrastructure/assistant/tanstack-agent-runner';
import type { AssistantConversationRepositoryPort } from '@/lib/core/port/secondary/assistant-conversation-repository-port';
import { FEATURE_REGISTRY, type FeatureFlagMap, type FeatureKey } from '@/lib/core/entity/feature-config';
import { makeConversation, makeNoopHandles } from 'test/fixtures/assistant-fixtures';

const allFlags = (): FeatureFlagMap => {
    const map = {} as FeatureFlagMap;
    (Object.keys(FEATURE_REGISTRY) as FeatureKey[]).forEach(key => {
        map[key] = true;
    });
    return map;
};

const SQL_RESULT = { columns: ['id'], rows: [{ id: 'secret-row' }], totalRows: 1 };

function setup(options: { repository?: AssistantConversationRepositoryPort; script?: () => AsyncGenerator<RunnerUpdate> } = {}) {
    const repository = options.repository ?? new InMemoryConversationRepository();
    const handles = makeNoopHandles();
    (getAssistantDataHandleStore as jest.Mock).mockReturnValue(handles);
    const runnerDeps: Array<() => AgentRunnerDeps> = [];
    const createRunner = (deps: () => AgentRunnerDeps): AgentRunner => {
        runnerDeps.push(deps);
        return {
            run: () =>
                (
                    options.script ??
                    async function* () {
                        yield { type: 'finished', status: 'completed' } as RunnerUpdate;
                    }
                )(),
            resolveApproval: jest.fn(),
        };
    };
    let current!: UseAssistantResult;
    let gate!: ReturnType<typeof useRefreshGate>;
    const Probe = () => {
        current = React.useContext(AssistantContext) as UseAssistantResult;
        gate = useRefreshGate();
        return null;
    };
    const view = render(
        <QueryClientProvider client={new QueryClient()}>
            <FeatureProvider features={allFlags()}>
                <AssistantShellProvider>
                    <AssistantProvider overrides={{ repository: Promise.resolve({ repository, persistent: true }), createRunner }}>
                        <Probe />
                    </AssistantProvider>
                </AssistantShellProvider>
            </FeatureProvider>
        </QueryClientProvider>,
    );
    return { repository, handles, runnerDeps, view, assistant: () => current, gate: () => gate };
}

describe('AssistantProvider data tools wiring', () => {
    beforeEach(() => localStorage.clear());

    it('uses the DuckDB store and terminates it on unmount', async () => {
        const { handles, view } = setup();
        expect(getAssistantDataHandleStore).toHaveBeenCalled();
        expect(handles.terminate).not.toHaveBeenCalled();
        view.unmount();
        expect(handles.terminate).toHaveBeenCalled();
    });

    it('offers only always-on tools until find_tools activates more, and persists the active set', async () => {
        const { assistant, runnerDeps, repository } = setup();
        await act(async () => {
            await assistant().send('stuck rules?');
        });
        const deps = runnerDeps[0]();
        const names = () => runnerDeps[0]().tools.map(tool => tool.spec.name);
        expect(names()).toEqual(expect.arrayContaining(['find_tools', 'run_sql', 'refresh_handle']));
        expect(names()).not.toContain('list_rules');
        expect(deps.systemPrompt).toContain('Call find_tools with a few keywords');

        const ctx = deps.makeToolContext('call-1', 't');
        expect(ctx.isToolVisible?.('list_rules')).toBe(true);
        expect(ctx.isToolVisible?.('no_such_tool')).toBe(false);
        expect(ctx.toolPolicy?.('list_rules')).toBe('allow');
        ctx.activateTools?.(['list_rules']);
        expect(names()).toContain('list_rules');

        await act(async () => {
            await assistant().send('and again');
        });
        await waitFor(async () => {
            const [stored] = await repository.listConversations('root@def');
            expect(stored.activeTools).toEqual(['list_rules']);
        });
    });

    it('credits a late find_tools to the conversation it ran in', async () => {
        const { assistant, runnerDeps } = setup();
        await act(async () => {
            await assistant().send('first');
        });
        const firstId = assistant().conversation?.id as string;
        const lateContext = runnerDeps[0]().makeToolContext('call-1', 't');
        act(() => assistant().newConversation());
        await waitFor(() => expect(assistant().conversation).toBeUndefined());
        lateContext.activateTools?.(['list_rules']);
        await act(async () => {
            await assistant().send('second');
        });
        expect(runnerDeps[runnerDeps.length - 1]().tools.map(tool => tool.spec.name)).not.toContain('list_rules');
        await act(async () => {
            await assistant().openConversation(firstId);
        });
        await act(async () => {
            await assistant().send('back again');
        });
        expect(runnerDeps[runnerDeps.length - 1]().tools.map(tool => tool.spec.name)).toContain('list_rules');
    });

    it('keeps the refresh gate on user visibility, not on the active set', () => {
        const { gate, runnerDeps } = setup();
        expect(runnerDeps).toHaveLength(0);
        expect(gate().isToolVisible?.('list_rules')).toBe(true);
        expect(gate().isToolVisible?.('no_such_tool')).toBe(false);
        expect(gate().toolPolicy?.('list_rules')).toBe('allow');
    });

    it('flags the user message of a blocked off-topic turn and clears the flag when a retry is answered', async () => {
        let blocked = true;
        const script = async function* (): AsyncGenerator<RunnerUpdate> {
            yield blocked ? { type: 'finished', status: 'error', error: OFF_TOPIC_ERROR } : { type: 'finished', status: 'completed' };
        };
        const { assistant, repository } = setup({ script: () => script() });
        await act(async () => {
            await assistant().send('write an essay');
        });
        const userMessage = () => assistant().messages.find(message => message.role === 'user');
        expect(userMessage()?.offTopic).toBe(true);
        expect(assistant().error).toMatch(/unrelated to Rucio/);
        const [stored] = await repository.listConversations('root@def');
        expect((await repository.listMessages(stored.id)).find(message => message.role === 'user')?.offTopic).toBe(true);

        blocked = false;
        await act(async () => {
            await assistant().retry();
        });
        expect(userMessage()?.offTopic).toBeUndefined();
        expect((await repository.listMessages(stored.id)).find(message => message.role === 'user')?.offTopic).toBeUndefined();
    });

    it('persists a run_sql result without its rows', async () => {
        const script = async function* (): AsyncGenerator<RunnerUpdate> {
            yield { type: 'tool-call', toolCallId: 'c1', toolName: 'run_sql', args: { sql: 'select 1' }, policy: 'allow' };
            yield { type: 'tool-result', toolCallId: 'c1', result: SQL_RESULT, durationMs: 1 };
            yield { type: 'finished', status: 'completed' };
        };
        const { assistant, repository } = setup({ script });
        await act(async () => {
            await assistant().send('count');
        });
        const [stored] = await repository.listConversations('root@def');
        const messages = await repository.listMessages(stored.id);
        expect(JSON.stringify(messages)).not.toContain('secret-row');
        expect(JSON.stringify(messages)).toContain('rowsOmitted');
        // the live transcript still has the rows for the result table
        expect(JSON.stringify(assistant().messages)).toContain('secret-row');
    });

    it('still reports a lost persistence layer through the wrapper', async () => {
        let lost: () => void = () => undefined;
        const base = new InMemoryConversationRepository();
        const repository = Object.assign(Object.create(base), {
            onPersistenceLost: (listener: () => void) => {
                lost = listener;
                return () => undefined;
            },
        }) as AssistantConversationRepositoryPort;
        const { assistant } = setup({ repository });
        await waitFor(() => expect(assistant().persistent).toBe(true));
        act(() => lost());
        await waitFor(() => expect(assistant().persistent).toBe(false));
    });

    it('passes the explicit account key of the sign-out hook through to the repository delete', async () => {
        const repository = new InMemoryConversationRepository();
        await repository.saveConversation(makeConversation('c1', 'alice@def'));
        await repository.saveConversation(makeConversation('c2', 'bob@def'));
        let controls: AssistantConversationControls | null = null;
        const Capture = () => {
            controls = useAssistantPanel().conversationControls;
            return null;
        };
        render(
            <QueryClientProvider client={new QueryClient()}>
                <FeatureProvider features={allFlags()}>
                    <AssistantShellProvider>
                        <AssistantProvider
                            overrides={{
                                repository: Promise.resolve({ repository, persistent: true }),
                                createRunner: () => ({ run: async function* () {}, resolveApproval: jest.fn() }),
                            }}
                        >
                            <Capture />
                        </AssistantProvider>
                    </AssistantShellProvider>
                </FeatureProvider>
            </QueryClientProvider>,
        );
        await waitFor(() => expect(controls).not.toBeNull());
        await act(async () => {
            await (controls as unknown as AssistantConversationControls).deleteAll('alice@def');
        });
        expect(await repository.listConversations('alice@def')).toEqual([]);
        expect((await repository.listConversations('bob@def')).map(c => c.id)).toEqual(['c2']);
    });
});
