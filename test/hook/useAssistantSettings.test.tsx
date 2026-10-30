import { act, renderHook } from '@testing-library/react';
import { useAssistantSettings } from '@/lib/infrastructure/hooks/useAssistantSettings';
import { ASSISTANT_SESSION_KEYS_KEY, ASSISTANT_SETTINGS_KEY, getDefaultAssistantSettings } from '@/lib/infrastructure/assistant/settings-storage';

describe('useAssistantSettings', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    it('starts from the defaults', () => {
        const { result } = renderHook(() => useAssistantSettings());
        expect(result.current.settings).toEqual(getDefaultAssistantSettings());
    });

    it('renders the defaults over corrupt storage without throwing', () => {
        localStorage.setItem(ASSISTANT_SETTINGS_KEY, '{"version": 1, "providers": [}');
        const { result } = renderHook(() => useAssistantSettings());
        expect(result.current.settings).toEqual(getDefaultAssistantSettings());
    });

    it('keeps the same object while nothing changes', () => {
        const { result, rerender } = renderHook(() => useAssistantSettings());
        const first = result.current.settings;
        rerender();
        expect(result.current.settings).toBe(first);
    });

    it('persists updates and re-renders', () => {
        const { result } = renderHook(() => useAssistantSettings());
        act(() => result.current.update(s => ({ ...s, display: { detail: 'verbose' } })));
        expect(result.current.settings.display.detail).toBe('verbose');
        expect(JSON.parse(localStorage.getItem(ASSISTANT_SETTINGS_KEY) ?? '{}').display).toEqual({ detail: 'verbose' });
    });

    it('keeps several hook instances in the same tab in sync', () => {
        const { result } = renderHook(() => ({ panel: useAssistantSettings(), page: useAssistantSettings() }));
        act(() => result.current.page.update(s => ({ ...s, activeProviderId: 'p-1' })));
        expect(result.current.panel.settings.activeProviderId).toBe('p-1');
    });

    it('picks up changes made in another tab', () => {
        const { result } = renderHook(() => useAssistantSettings());
        act(() => {
            localStorage.setItem(ASSISTANT_SETTINGS_KEY, JSON.stringify({ ...getDefaultAssistantSettings(), display: { detail: 'verbose' } }));
            window.dispatchEvent(new StorageEvent('storage', { key: ASSISTANT_SETTINGS_KEY }));
        });
        expect(result.current.settings.display.detail).toBe('verbose');
    });

    it('resets everything, including session keys', () => {
        const { result } = renderHook(() => useAssistantSettings());
        act(() =>
            result.current.update(s => ({
                ...s,
                keyStorage: 'session',
                providers: [{ id: 'p-1', kind: 'openai', label: 'Mine', apiKey: 'sk-x', model: 'gpt-5.4-mini' }],
            })),
        );
        expect(sessionStorage.getItem(ASSISTANT_SESSION_KEYS_KEY)).not.toBeNull();
        act(() => result.current.reset());
        expect(localStorage.getItem(ASSISTANT_SETTINGS_KEY)).toBeNull();
        expect(sessionStorage.getItem(ASSISTANT_SESSION_KEYS_KEY)).toBeNull();
        expect(result.current.settings).toEqual(getDefaultAssistantSettings());
    });
});
