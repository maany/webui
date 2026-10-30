type MockUser = { rucioAccount: string; rucioVO: string };
const mockSession: { current: { user: MockUser; allUsers?: MockUser[] } | null } = {
    current: { user: { rucioAccount: 'alice', rucioVO: 'def' } },
};
jest.mock('next-auth/react', () => ({
    useSession: () => ({ data: mockSession.current }),
}));
jest.mock('@/lib/infrastructure/assistant/indexeddb-conversation-repository', () => ({
    createConversationRepository: jest.fn(),
}));
jest.mock('@/component-library/features/assistant/AssistantRoot', () => ({ __esModule: true, default: () => <div data-testid="assistant-root" /> }));

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FeatureProvider } from '@/component-library/features/feature-flags/FeatureProvider';
import { AssistantHeaderButton } from '@/component-library/features/assistant/AssistantHeaderButton';
import { AssistantMount } from '@/component-library/features/assistant/AssistantMount';
import { InMemoryConversationRepository } from '@/lib/infrastructure/assistant/in-memory-conversation-repository';
import { createConversationRepository } from '@/lib/infrastructure/assistant/indexeddb-conversation-repository';
import { getAttachedPageActionRegistry } from '@/lib/infrastructure/assistant/page-action-bridge';
import { ASSISTANT_SETTINGS_KEY, getDefaultAssistantSettings } from '@/lib/infrastructure/assistant/settings-storage';
import { runSignOutHooks } from '@/lib/infrastructure/auth/sign-out-hooks';
import { AssistantShellProvider, useAssistantPanel, type AssistantConversationControls } from '@/lib/infrastructure/hooks/useAssistantShell';
import { CommandPaletteProvider, useCommandPalette } from '@/lib/infrastructure/hooks/useCommandPalette';
import { makeConversation } from 'test/fixtures/assistant-fixtures';
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
        (createConversationRepository as jest.Mock).mockReset();
        mockSession.current = { user: { rucioAccount: 'alice', rucioVO: 'def' } };
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
        unmount();
    });

    function enableClearOnLogout() {
        const defaults = getDefaultAssistantSettings();
        localStorage.setItem(ASSISTANT_SETTINGS_KEY, JSON.stringify({ ...defaults, retention: { ...defaults.retention, clearOnLogout: true } }));
    }

    async function seedTwoAccounts() {
        const repository = new InMemoryConversationRepository();
        await repository.saveConversation(makeConversation('a1', 'alice@def', '2026-10-24T08:00:00.000Z'));
        await repository.saveConversation(makeConversation('a2', 'alice@def', '2026-10-23T08:00:00.000Z'));
        await repository.saveConversation(makeConversation('b1', 'bob@def', '2026-10-24T08:00:00.000Z'));
        (createConversationRepository as jest.Mock).mockResolvedValue({ repository, persistent: true });
        return repository;
    }

    it('deletes only the signed-out account chats, and only when clear on logout is on', async () => {
        const repository = await seedTwoAccounts();
        renderShell(true);
        await act(async () => {
            await runSignOutHooks();
        });
        expect((await repository.listConversations('alice@def')).length).toBe(2);
        enableClearOnLogout();
        await act(async () => {
            await runSignOutHooks();
        });
        expect(await repository.listConversations('alice@def')).toEqual([]);
        expect((await repository.listConversations('bob@def')).map(c => c.id)).toEqual(['b1']);
    });

    it('stops the turn through the conversation controller when the panel registered one, then deletes', async () => {
        const repository = await seedTwoAccounts();
        enableClearOnLogout();
        const controls: AssistantConversationControls = {
            deleteConversation: jest.fn().mockResolvedValue(undefined),
            deleteAll: jest.fn().mockResolvedValue(undefined),
            deleteAllAccounts: jest.fn(),
        };
        function Register() {
            const { registerConversationControls } = useAssistantPanel();
            React.useEffect(() => registerConversationControls(controls), [registerConversationControls]);
            return null;
        }
        render(
            <FeatureProvider features={flagMap({ assistant: true })}>
                <AssistantShellProvider>
                    <Register />
                </AssistantShellProvider>
            </FeatureProvider>,
        );
        await act(async () => {
            await runSignOutHooks();
        });
        expect(controls.deleteAll).toHaveBeenCalledTimes(1);
        expect(controls.deleteAll).toHaveBeenCalledWith('alice@def');
        // The repository delete runs too, so the clear does not depend on the controller.
        expect(await repository.listConversations('alice@def')).toEqual([]);
        expect((await repository.listConversations('bob@def')).length).toBe(1);
    });

    it('starts the repository delete without waiting for a controller delete that hangs', async () => {
        const repository = await seedTwoAccounts();
        enableClearOnLogout();
        const controls: AssistantConversationControls = {
            deleteConversation: jest.fn(),
            deleteAll: jest.fn().mockReturnValue(new Promise<void>(() => undefined)),
            deleteAllAccounts: jest.fn(),
        };
        function Register() {
            const { registerConversationControls } = useAssistantPanel();
            React.useEffect(() => registerConversationControls(controls), [registerConversationControls]);
            return null;
        }
        render(
            <FeatureProvider features={flagMap({ assistant: true })}>
                <AssistantShellProvider>
                    <Register />
                </AssistantShellProvider>
            </FeatureProvider>,
        );
        void runSignOutHooks();
        await waitFor(async () => expect(await repository.listConversations('alice@def')).toEqual([]));
        expect(controls.deleteAll).toHaveBeenCalledWith('alice@def');
    });

    it('falls back to the repository when the controller delete fails, and never throws', async () => {
        const repository = await seedTwoAccounts();
        enableClearOnLogout();
        const controls: AssistantConversationControls = {
            deleteConversation: jest.fn(),
            deleteAll: jest.fn().mockRejectedValue(new Error('boom')),
            deleteAllAccounts: jest.fn(),
        };
        function Register() {
            const { registerConversationControls } = useAssistantPanel();
            React.useEffect(() => registerConversationControls(controls), [registerConversationControls]);
            return null;
        }
        render(
            <FeatureProvider features={flagMap({ assistant: true })}>
                <AssistantShellProvider>
                    <Register />
                </AssistantShellProvider>
            </FeatureProvider>,
        );
        await act(async () => {
            await runSignOutHooks();
        });
        expect(await repository.listConversations('alice@def')).toEqual([]);
        expect((await repository.listConversations('bob@def')).length).toBe(1);
    });

    it('does nothing when the repository cannot open, and when nobody was ever signed in', async () => {
        const repository = await seedTwoAccounts();
        enableClearOnLogout();
        mockSession.current = null;
        renderShell(true);
        await act(async () => {
            await runSignOutHooks();
        });
        expect(createConversationRepository).not.toHaveBeenCalled();
        mockSession.current = { user: { rucioAccount: 'alice', rucioVO: 'def' } };
        (createConversationRepository as jest.Mock).mockRejectedValue(new Error('no idb'));
        renderShell(true);
        await act(async () => {
            await runSignOutHooks();
        });
        expect((await repository.listConversations('alice@def')).length).toBe(2);
    });

    it('still clears the last signed-in account after the session already expired', async () => {
        const repository = await seedTwoAccounts();
        enableClearOnLogout();
        const { rerender } = renderShell(true);
        mockSession.current = null;
        rerender(
            <FeatureProvider features={flagMap({ assistant: true })}>
                <AssistantShellProvider>
                    <PanelState />
                </AssistantShellProvider>
            </FeatureProvider>,
        );
        await act(async () => {
            await runSignOutHooks();
        });
        expect(await repository.listConversations('alice@def')).toEqual([]);
        expect((await repository.listConversations('bob@def')).length).toBe(1);
    });

    it('clears the active account through the repository even when the controller no-ops after expiry', async () => {
        const repository = await seedTwoAccounts();
        enableClearOnLogout();
        // Like the real controller, which has no account key once the session is gone and returns early.
        const controls: AssistantConversationControls = {
            deleteConversation: jest.fn(),
            deleteAll: jest.fn().mockResolvedValue(undefined),
            deleteAllAccounts: jest.fn(),
        };
        function Register() {
            const { registerConversationControls } = useAssistantPanel();
            React.useEffect(() => registerConversationControls(controls), [registerConversationControls]);
            return null;
        }
        const tree = () => (
            <FeatureProvider features={flagMap({ assistant: true })}>
                <AssistantShellProvider>
                    <Register />
                </AssistantShellProvider>
            </FeatureProvider>
        );
        const { rerender } = render(tree());
        mockSession.current = null;
        rerender(tree());
        await act(async () => {
            await runSignOutHooks();
        });
        expect(controls.deleteAll).toHaveBeenCalledWith('alice@def');
        expect(await repository.listConversations('alice@def')).toEqual([]);
        expect((await repository.listConversations('bob@def')).length).toBe(1);
    });

    it('clears every account the sign-out ends, and no stored-only account', async () => {
        const repository = await seedTwoAccounts();
        await repository.saveConversation(makeConversation('c1', 'carol@def', '2026-10-24T08:00:00.000Z'));
        enableClearOnLogout();
        mockSession.current = {
            user: { rucioAccount: 'alice', rucioVO: 'def' },
            allUsers: [
                { rucioAccount: 'alice', rucioVO: 'def' },
                { rucioAccount: 'bob', rucioVO: 'def' },
            ],
        };
        renderShell(true);
        await act(async () => {
            await runSignOutHooks();
        });
        expect(await repository.listConversations('alice@def')).toEqual([]);
        expect(await repository.listConversations('bob@def')).toEqual([]);
        expect((await repository.listConversations('carol@def')).length).toBe(1);
    });

    it('ignores the shortcut while an IME composition is active', () => {
        renderShell(true);
        fireEvent.keyDown(window, { code: 'Space', key: ' ', ctrlKey: true, shiftKey: true, isComposing: true });
        fireEvent.keyDown(window, { code: 'Space', key: ' ', ctrlKey: true, shiftKey: true, keyCode: 229 });
        expect(screen.getByTestId('panel-state')).toHaveTextContent('closed');
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
