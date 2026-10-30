import { renderHook, waitFor } from '@testing-library/react';
import type { AssistantDataHandleStorePort } from '@/lib/core/port/secondary/assistant-data-handle-store-port';
import { DuckDbDataHandleStore } from '@/lib/infrastructure/assistant/duckdb/duckdb-data-handle-store';
import { createAssistantEventBus } from '@/lib/infrastructure/assistant/event-bus';
import { InMemoryConversationRepository } from '@/lib/infrastructure/assistant/in-memory-conversation-repository';
import { useAssistantController, type AssistantControllerDeps } from '@/lib/infrastructure/hooks/useAssistant';
import { useDataHandleLifecycle } from '@/lib/infrastructure/hooks/useDataHandleLifecycle';
import { makePages } from 'test/fixtures/assistant-fixtures';
import { FakeDuckDbEngine, rowsOf } from 'test/fixtures/assistant/fake-duckdb-engine';

describe('useDataHandleLifecycle', () => {
    it('terminates DuckDB only when the provider unmounts', () => {
        const store = { terminate: jest.fn(async () => undefined) } as unknown as AssistantDataHandleStorePort & { terminate: jest.Mock };
        const { rerender, unmount } = renderHook(() => useDataHandleLifecycle(store));
        rerender();
        expect(store.terminate).not.toHaveBeenCalled();
        unmount();
        expect(store.terminate).toHaveBeenCalledTimes(1);
    });
});

describe('phase 1b controller with the DuckDB store', () => {
    it('drops every DuckDB handle on an account switch (Review Focus 3)', async () => {
        const engine = new FakeDuckDbEngine();
        const store = new DuckDbDataHandleStore(async () => engine);
        const repository = new InMemoryConversationRepository();
        const deps = (accountKey: string): AssistantControllerDeps => ({
            accountKey,
            repository: Promise.resolve({ repository, persistent: true }),
            resolveProvider: () => ({ error: 'no-provider' }),
            visibleTools: () => [],
            makePolicyFor: () => () => 'allow',
            toolContextExtras: () => ({}),
            pageContext: () => undefined,
            retention: () => ({ maxAgeDays: 30, maxTotalMB: 50, clearOnLogout: false }),
            handles: store,
            pages: makePages(),
            bus: createAssistantEventBus(),
            navigate: jest.fn(),
            queryClient: {} as AssistantControllerDeps['queryClient'],
            createRunner: jest.fn(),
            summarize: jest.fn(),
        });
        const hook = renderHook(({ accountKey }: { accountKey: string }) => useAssistantController(deps(accountKey)), {
            initialProps: { accountKey: 'alice@atlas' },
        });
        await store.ingestRows('rules', { toolName: 'list_rules', args: {}, fetchedAt: 'x' }, rowsOf([{ id: 'a' }]), { rowCap: 10 });
        expect(store.listHandles()).toHaveLength(1);

        hook.rerender({ accountKey: 'bob@atlas' });

        await waitFor(() => expect(store.listHandles()).toEqual([]));
        await waitFor(() => expect(engine.tables.has('rules_1')).toBe(false));
        expect(engine.executed).toContain('DROP TABLE IF EXISTS "rules_1"');
    });
});
