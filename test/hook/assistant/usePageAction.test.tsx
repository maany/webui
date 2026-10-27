import { act, renderHook } from '@testing-library/react';
import { z } from 'zod';
import { usePageAction } from '@/lib/infrastructure/hooks/usePageAction';
import { attachPageActionRegistry } from '@/lib/infrastructure/assistant/page-action-bridge';
import { FakePageActionRegistry } from 'test/fixtures/fake-page-action-registry';

const schema = z.object({ query: z.string() });

describe('usePageAction', () => {
    let registry: FakePageActionRegistry;
    let detach: () => void;

    beforeEach(() => {
        registry = new FakePageActionRegistry();
        detach = attachPageActionRegistry(registry);
    });

    afterEach(() => detach());

    it('registers on mount and unregisters on unmount', () => {
        const { unmount } = renderHook(() => usePageAction({ name: 'demo.search', description: 'Search the demo', schema, apply: async () => 'ok' }));
        expect(registry.list().map(action => action.name)).toEqual(['demo.search']);
        expect(registry.list()[0].description).toBe('Search the demo');

        unmount();
        expect(registry.list()).toEqual([]);
    });

    it('passes the declared risk through and defaults to read', () => {
        renderHook(() => usePageAction({ name: 'demo.search', description: 'Search', schema, apply: async () => 'ok' }));
        renderHook(() => usePageAction({ name: 'demo.delete', description: 'Delete', schema, apply: async () => 'ok', risk: 'write' }));
        expect(registry.list().map(action => [action.name, action.risk])).toEqual([
            ['demo.search', 'read'],
            ['demo.delete', 'write'],
        ]);
    });

    it('calls the latest apply without registering again', async () => {
        const first = jest.fn(async () => 'first');
        const second = jest.fn(async () => 'second');
        const { rerender } = renderHook(
            ({ apply }: { apply: (args: { query: string }) => Promise<string> }) =>
                usePageAction({ name: 'demo.search', description: 'Search the demo', schema, apply }),
            { initialProps: { apply: first } },
        );

        rerender({ apply: second });

        await expect(registry.invoke('demo.search', { query: 'x' })).resolves.toBe('second');
        expect(second).toHaveBeenCalledWith({ query: 'x' });
        expect(first).not.toHaveBeenCalled();
        expect(registry.registerCount).toBe(1);
    });

    it('rejects arguments that do not match the schema', async () => {
        renderHook(() => usePageAction({ name: 'demo.search', description: 'Search the demo', schema, apply: async () => 'ok' }));
        await expect(registry.invoke('demo.search', { query: 1 })).rejects.toMatchObject({ error: 'invalid_args' });
    });

    it('does nothing while disabled', () => {
        renderHook(() => usePageAction({ name: 'demo.search', description: 'Search the demo', schema, apply: async () => 'ok' }, { enabled: false }));
        expect(registry.list()).toEqual([]);
    });

    it('is a no-op without a registry and registers once one is attached', () => {
        detach();
        const { unmount } = renderHook(() => usePageAction({ name: 'demo.search', description: 'Search the demo', schema, apply: async () => 'ok' }));
        expect(registry.list()).toEqual([]);

        act(() => {
            detach = attachPageActionRegistry(registry);
        });
        expect(registry.list().map(action => action.name)).toEqual(['demo.search']);

        unmount();
        expect(registry.list()).toEqual([]);
    });
});
