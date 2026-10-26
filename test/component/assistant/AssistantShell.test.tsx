jest.mock('@/lib/infrastructure/assistant/indexeddb-conversation-repository', () => ({
    deleteAssistantDatabase: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/component-library/features/assistant/AssistantRoot', () => ({ __esModule: true, default: () => <div data-testid="assistant-root" /> }));

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { FeatureProvider } from '@/component-library/features/feature-flags/FeatureProvider';
import { AssistantHeaderButton } from '@/component-library/features/assistant/AssistantHeaderButton';
import { AssistantMount } from '@/component-library/features/assistant/AssistantMount';
import { deleteAssistantDatabase } from '@/lib/infrastructure/assistant/indexeddb-conversation-repository';
import { getAttachedPageActionRegistry } from '@/lib/infrastructure/assistant/page-action-bridge';
import { ASSISTANT_SETTINGS_KEY, getDefaultAssistantSettings } from '@/lib/infrastructure/assistant/settings-storage';
import { runSignOutHooks } from '@/lib/infrastructure/auth/sign-out-hooks';
import { AssistantShellProvider, useAssistantPanel } from '@/lib/infrastructure/hooks/useAssistantShell';
import { CommandPaletteProvider, useCommandPalette } from '@/lib/infrastructure/hooks/useCommandPalette';
import { flagMap } from 'test/fixtures/assistant-flags';

function PanelState() {
    const { panelState, minimize } = useAssistantPanel();
    return (
        <>
            <span data-testid="panel-state">{panelState}</span>
            <button type="button" onClick={minimize}>
                minimize
            </button>
        </>
    );
}

function renderShell(enabled: boolean) {
    return render(
        <FeatureProvider features={flagMap({ assistant: enabled })}>
            <AssistantShellProvider>
                <AssistantHeaderButton />
                <PanelState />
                <AssistantMount />
            </AssistantShellProvider>
        </FeatureProvider>,
    );
}

function setMobile(matches: boolean) {
    // The component setup defines window.matchMedia as writable, so plain assignment works.
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
        matches,
        media: query,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
    })) as unknown as typeof window.matchMedia;
}

describe('Rucio bot shell', () => {
    beforeEach(() => {
        setMobile(false);
        localStorage.clear();
        (deleteAssistantDatabase as jest.Mock).mockClear();
    });

    it('renders nothing, loads nothing and ignores the shortcut when the flag is off', async () => {
        renderShell(false);
        expect(screen.queryByRole('button', { name: /Rucio bot/ })).toBeNull();
        fireEvent.keyDown(window, { code: 'Space', key: ' ', ctrlKey: true, shiftKey: true });
        expect(screen.getByTestId('panel-state')).toHaveTextContent('closed');
        expect(screen.queryByTestId('assistant-root')).toBeNull();
        expect(getAttachedPageActionRegistry()).toBeNull();
    });

    it('loads the panel bundle only after the first open, from the header button or Ctrl+Shift+Space', async () => {
        renderShell(true);
        expect(screen.queryByTestId('assistant-root')).toBeNull();
        expect(getAttachedPageActionRegistry()).not.toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Rucio bot (Ctrl+Shift+Space)' }));
        expect(screen.getByTestId('panel-state')).toHaveTextContent('open');
        expect(await screen.findByTestId('assistant-root')).toBeInTheDocument();
        fireEvent.keyDown(window, { code: 'Space', key: ' ', ctrlKey: true, shiftKey: true });
        expect(screen.getByTestId('panel-state')).toHaveTextContent('closed');
        expect(screen.getByTestId('assistant-root')).toBeInTheDocument();
    });

    it('toggles with Cmd+Shift+Space, accepts the key value when code is missing, and ignores the old Ctrl+Shift+K', () => {
        renderShell(true);
        fireEvent.keyDown(window, { key: 'K', ctrlKey: true, shiftKey: true });
        expect(screen.getByTestId('panel-state')).toHaveTextContent('closed');
        fireEvent.keyDown(window, { code: 'Space', key: ' ', metaKey: true, shiftKey: true });
        expect(screen.getByTestId('panel-state')).toHaveTextContent('open');
        fireEvent.keyDown(window, { key: ' ', ctrlKey: true, shiftKey: true });
        expect(screen.getByTestId('panel-state')).toHaveTextContent('closed');
        fireEvent.keyDown(window, { code: 'Space', key: ' ', ctrlKey: true });
        fireEvent.keyDown(window, { code: 'Space', key: ' ', ctrlKey: true, shiftKey: true, altKey: true });
        expect(screen.getByTestId('panel-state')).toHaveTextContent('closed');
    });

    it('labels the header button with the platform shortcut', () => {
        const platform = jest.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
        renderShell(true);
        expect(screen.getByRole('button', { name: 'Rucio bot (⌘+Shift+Space)' })).toBeInTheDocument();
        platform.mockRestore();
    });

    it('minimize() only shrinks the panel on mobile', () => {
        renderShell(true);
        fireEvent.click(screen.getByRole('button', { name: 'Rucio bot (Ctrl+Shift+Space)' }));
        fireEvent.click(screen.getByRole('button', { name: 'minimize' }));
        expect(screen.getByTestId('panel-state')).toHaveTextContent('open');
        setMobile(true);
        fireEvent.click(screen.getByRole('button', { name: 'minimize' }));
        expect(screen.getByTestId('panel-state')).toHaveTextContent('minimized');
    });

    it('registers no sign-out hook when the flag is off, even with clear on logout set', async () => {
        const defaults = getDefaultAssistantSettings();
        localStorage.setItem(ASSISTANT_SETTINGS_KEY, JSON.stringify({ ...defaults, retention: { ...defaults.retention, clearOnLogout: true } }));
        const { unmount } = renderShell(false);
        await act(async () => {
            await runSignOutHooks();
        });
        expect(deleteAssistantDatabase).not.toHaveBeenCalled();
        unmount();
    });

    it('deletes stored chats on sign-out only when clear on logout is on', async () => {
        renderShell(true);
        await act(async () => {
            await runSignOutHooks();
        });
        expect(deleteAssistantDatabase).not.toHaveBeenCalled();
        const defaults = getDefaultAssistantSettings();
        localStorage.setItem(ASSISTANT_SETTINGS_KEY, JSON.stringify({ ...defaults, retention: { ...defaults.retention, clearOnLogout: true } }));
        await act(async () => {
            await runSignOutHooks();
        });
        expect(deleteAssistantDatabase).toHaveBeenCalledTimes(1);
    });

    it('returns focus to the element that opened the panel when it closes', () => {
        renderShell(true);
        const button = screen.getByRole('button', { name: 'Rucio bot (Ctrl+Shift+Space)' });
        button.focus();
        fireEvent.click(button);
        expect(screen.getByTestId('panel-state')).toHaveTextContent('open');
        // Focus moved into the panel, as the composer would take it.
        (document.activeElement as HTMLElement | null)?.blur();
        fireEvent.click(button);
        expect(screen.getByTestId('panel-state')).toHaveTextContent('closed');
        expect(button).toHaveFocus();
    });

    it('does not steal focus back when the panel was opened with nothing focused', () => {
        renderShell(true);
        fireEvent.keyDown(window, { code: 'Space', key: ' ', ctrlKey: true, shiftKey: true });
        const other = document.createElement('input');
        document.body.appendChild(other);
        other.focus();
        fireEvent.keyDown(window, { code: 'Space', key: ' ', ctrlKey: true, shiftKey: true });
        expect(screen.getByTestId('panel-state')).toHaveTextContent('closed');
        expect(other).toHaveFocus();
        other.remove();
    });

    it('ignores auto-repeated shortcut keydowns', () => {
        renderShell(true);
        fireEvent.keyDown(window, { code: 'Space', key: ' ', ctrlKey: true, shiftKey: true });
        expect(screen.getByTestId('panel-state')).toHaveTextContent('open');
        fireEvent.keyDown(window, { code: 'Space', key: ' ', ctrlKey: true, shiftKey: true, repeat: true });
        expect(screen.getByTestId('panel-state')).toHaveTextContent('open');
    });

    it('does nothing while the command palette is open', () => {
        function OpenPalette() {
            const { open, close } = useCommandPalette();
            return (
                <>
                    <button type="button" onClick={open}>
                        palette open
                    </button>
                    <button type="button" onClick={close}>
                        palette close
                    </button>
                </>
            );
        }
        render(
            <FeatureProvider features={flagMap({ assistant: true })}>
                <CommandPaletteProvider>
                    <AssistantShellProvider>
                        <OpenPalette />
                        <PanelState />
                    </AssistantShellProvider>
                </CommandPaletteProvider>
            </FeatureProvider>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'palette open' }));
        const event = new KeyboardEvent('keydown', { code: 'Space', key: ' ', ctrlKey: true, shiftKey: true, cancelable: true, bubbles: true });
        act(() => {
            window.dispatchEvent(event);
        });
        expect(screen.getByTestId('panel-state')).toHaveTextContent('closed');
        expect(event.defaultPrevented).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'palette close' }));
        fireEvent.keyDown(window, { code: 'Space', key: ' ', ctrlKey: true, shiftKey: true });
        expect(screen.getByTestId('panel-state')).toHaveTextContent('open');
    });
});
