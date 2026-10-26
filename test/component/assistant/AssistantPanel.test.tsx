jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ href, children, prefetch, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { FeatureProvider } from '@/component-library/features/feature-flags/FeatureProvider';
import { AssistantPanel } from '@/component-library/features/assistant/AssistantPanel';
import { AssistantContext, type UseAssistantResult } from '@/lib/infrastructure/hooks/useAssistant';
import { ASSISTANT_INERT_TARGET_ID, AssistantShellProvider, useAssistantPanel } from '@/lib/infrastructure/hooks/useAssistantShell';
import { savePanelWidth } from '@/lib/infrastructure/assistant/panel-storage';
import { flagMap } from 'test/fixtures/assistant-flags';

function assistantResult(overrides: Partial<UseAssistantResult> = {}): UseAssistantResult {
    return {
        status: 'idle',
        conversation: undefined,
        conversations: [],
        messages: [],
        pendingApprovals: [],
        contextFraction: null,
        send: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn(),
        resolveApproval: jest.fn(),
        newConversation: jest.fn(),
        openConversation: jest.fn().mockResolvedValue(undefined),
        deleteConversation: jest.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

function Controls() {
    const { toggle, minimize, panelState } = useAssistantPanel();
    return (
        <>
            <button type="button" onClick={toggle}>
                opener
            </button>
            <button type="button" onClick={minimize}>
                minimize
            </button>
            <span data-testid="state">{panelState}</span>
        </>
    );
}

function setViewport(width: number, mobile: boolean) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
        matches: mobile,
        media: query,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
    })) as unknown as typeof window.matchMedia;
}

function renderPanel(assistant: UseAssistantResult = assistantResult()) {
    return render(
        <FeatureProvider features={flagMap({ assistant: true })}>
            <AssistantShellProvider>
                <div id={ASSISTANT_INERT_TARGET_ID}>
                    <Controls />
                </div>
                <AssistantContext.Provider value={assistant}>
                    <AssistantPanel />
                </AssistantContext.Provider>
            </AssistantShellProvider>
        </FeatureProvider>,
    );
}

describe('AssistantPanel', () => {
    beforeEach(() => {
        localStorage.clear();
        setViewport(1440, false);
    });

    describe('mobile sheet', () => {
        beforeEach(() => setViewport(500, true));

        it('makes the app content inert while the sheet is open and releases it on minimize and close', () => {
            renderPanel();
            const content = document.getElementById(ASSISTANT_INERT_TARGET_ID) as HTMLElement;
            expect(content).not.toHaveAttribute('inert');
            fireEvent.click(screen.getByRole('button', { name: 'opener' }));
            expect(content).toHaveAttribute('inert');
            fireEvent.click(screen.getByRole('button', { name: 'Close Rucio bot' }));
            expect(content).not.toHaveAttribute('inert');
        });

        it('releases the inert content when the sheet is minimized', () => {
            renderPanel();
            const content = document.getElementById(ASSISTANT_INERT_TARGET_ID) as HTMLElement;
            fireEvent.click(screen.getByRole('button', { name: 'opener' }));
            expect(content).toHaveAttribute('inert');
            fireEvent.click(screen.getByRole('button', { name: 'minimize' }));
            expect(screen.getByTestId('state')).toHaveTextContent('minimized');
            expect(content).not.toHaveAttribute('inert');
        });
    });

    it('does not make the page inert on desktop', () => {
        renderPanel();
        fireEvent.click(screen.getByRole('button', { name: 'opener' }));
        expect(screen.getByRole('complementary', { name: 'Rucio bot' })).toBeInTheDocument();
        expect(document.getElementById(ASSISTANT_INERT_TARGET_ID)).not.toHaveAttribute('inert');
    });

    describe('docked width', () => {
        const panelWidth = () => screen.getByRole('complementary', { name: 'Rucio bot' }).style.width;
        const resizeTo = (width: number) =>
            act(() => {
                Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
                window.dispatchEvent(new Event('resize'));
            });

        it('clamps the stored width to 45% of the viewport on load and when the window resizes', () => {
            savePanelWidth(700);
            setViewport(1000, false);
            renderPanel();
            fireEvent.click(screen.getByRole('button', { name: 'opener' }));
            expect(panelWidth()).toBe('450px');
            expect(document.documentElement.style.getPropertyValue('--rucio-assistant-offset')).toBe('450px');
            resizeTo(800);
            expect(panelWidth()).toBe('360px');
            expect(document.documentElement.style.getPropertyValue('--rucio-assistant-offset')).toBe('360px');
            resizeTo(1800);
            expect(panelWidth()).toBe('700px');
        });

        it('stops listening for resize once unmounted', () => {
            const remove = jest.spyOn(window, 'removeEventListener');
            const { unmount } = renderPanel();
            fireEvent.click(screen.getByRole('button', { name: 'opener' }));
            unmount();
            expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
            remove.mockRestore();
        });
    });
});
