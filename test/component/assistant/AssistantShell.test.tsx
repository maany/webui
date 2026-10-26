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
        fireEvent.keyDown(window, { key: 'K', ctrlKey: true, shiftKey: true });
        expect(screen.getByTestId('panel-state')).toHaveTextContent('closed');
        expect(screen.queryByTestId('assistant-root')).toBeNull();
        expect(getAttachedPageActionRegistry()).toBeNull();
    });

    it('loads the panel bundle only after the first open, from the header button or Ctrl+Shift+K', async () => {
        renderShell(true);
        expect(screen.queryByTestId('assistant-root')).toBeNull();
        expect(getAttachedPageActionRegistry()).not.toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Rucio bot (Ctrl+Shift+K)' }));
        expect(screen.getByTestId('panel-state')).toHaveTextContent('open');
        expect(await screen.findByTestId('assistant-root')).toBeInTheDocument();
        fireEvent.keyDown(window, { key: 'K', ctrlKey: true, shiftKey: true });
        expect(screen.getByTestId('panel-state')).toHaveTextContent('closed');
        expect(screen.getByTestId('assistant-root')).toBeInTheDocument();
    });

    it('minimize() only shrinks the panel on mobile', () => {
        renderShell(true);
        fireEvent.click(screen.getByRole('button', { name: 'Rucio bot (Ctrl+Shift+K)' }));
        fireEvent.click(screen.getByRole('button', { name: 'minimize' }));
        expect(screen.getByTestId('panel-state')).toHaveTextContent('open');
        setMobile(true);
        fireEvent.click(screen.getByRole('button', { name: 'minimize' }));
        expect(screen.getByTestId('panel-state')).toHaveTextContent('minimized');
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
});
