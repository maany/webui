import { renderHook } from '@testing-library/react';
import { usePageDescribe } from '@/lib/infrastructure/hooks/usePageDescribe';
import { attachPageActionRegistry } from '@/lib/infrastructure/assistant/page-action-bridge';
import { FakePageActionRegistry } from 'test/fixtures/fake-page-action-registry';

describe('usePageDescribe', () => {
    let registry: FakePageActionRegistry;
    let detach: () => void;

    beforeEach(() => {
        registry = new FakePageActionRegistry();
        detach = attachPageActionRegistry(registry);
    });

    afterEach(() => detach());

    it('sets the describer on mount and clears it on unmount', () => {
        const { unmount } = renderHook(() => usePageDescribe(() => 'Rule abc, state Stuck.'));
        expect(registry.describe()).toBe('Rule abc, state Stuck.');

        unmount();
        expect(registry.describe()).toBeUndefined();
    });

    it('reads the latest data on every call', () => {
        const { rerender } = renderHook(({ state }: { state: string }) => usePageDescribe(() => `Rule abc, state ${state}.`), {
            initialProps: { state: 'Replicating' },
        });
        rerender({ state: 'OK' });
        expect(registry.describe()).toBe('Rule abc, state OK.');
    });

    it('collapses whitespace and clamps to 500 characters', () => {
        renderHook(() => usePageDescribe(() => `Start   ${'a'.repeat(800)}`));
        const summary = registry.describe() ?? '';
        expect(summary).toHaveLength(500);
        expect(summary.startsWith('Start a')).toBe(true);
        expect(summary.endsWith('...')).toBe(true);
    });

    it('returns an empty summary when the page describer throws', () => {
        renderHook(() =>
            usePageDescribe(() => {
                throw new Error('not loaded');
            }),
        );
        expect(registry.describe()).toBe('');
    });

    it('does nothing while disabled or without a registry', () => {
        renderHook(() => usePageDescribe(() => 'x', { enabled: false }));
        expect(registry.describe()).toBeUndefined();

        detach();
        expect(() => renderHook(() => usePageDescribe(() => 'x'))).not.toThrow();
    });
});
