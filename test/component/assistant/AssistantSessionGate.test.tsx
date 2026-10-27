jest.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }));
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
import { ReauthModal } from '@/component-library/features/auth/ReauthModal';
import { AssistantContext, type UseAssistantResult } from '@/lib/infrastructure/hooks/useAssistant';
import { ASSISTANT_INERT_TARGET_ID, AssistantShellProvider, useAssistantPanel } from '@/lib/infrastructure/hooks/useAssistantShell';
import { SessionGateContext, type SessionGateStatus } from '@/lib/infrastructure/auth/session-gate';
import { flagMap } from 'test/fixtures/assistant-flags';

function assistantResult(): UseAssistantResult {
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
    };
}

function Controls() {
    const { open, toggle, minimize, panelState } = useAssistantPanel();
    return (
        <>
            <button type="button" onClick={open}>
                open
            </button>
            <button type="button" onClick={toggle}>
                toggle
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

function tree(status: SessionGateStatus) {
    return (
        <SessionGateContext.Provider value={{ status }}>
            <FeatureProvider features={flagMap({ assistant: true })}>
                <AssistantShellProvider>
                    <div id={ASSISTANT_INERT_TARGET_ID}>
                        <Controls />
                    </div>
                    <AssistantContext.Provider value={assistantResult()}>
                        <AssistantPanel />
                    </AssistantContext.Provider>
                </AssistantShellProvider>
            </FeatureProvider>
        </SessionGateContext.Provider>
    );
}

describe('Rucio bot session gate', () => {
    beforeEach(() => {
        localStorage.clear();
        setViewport(1440, false);
    });

    it('covers the open panel with inert and aria-hidden once the session is not active, and releases it on restore', () => {
        const view = render(tree('active'));
        fireEvent.click(screen.getByRole('button', { name: 'open' }));
        const panel = screen.getByRole('complementary', { name: 'Rucio bot' });
        expect(panel).not.toHaveAttribute('inert');
        expect(panel).not.toHaveAttribute('aria-hidden');
        view.rerender(tree('reauth-required'));
        const blocked = view.container.ownerDocument.querySelector('aside') as HTMLElement;
        expect(blocked).toHaveAttribute('inert');
        expect(blocked).toHaveAttribute('aria-hidden', 'true');
        view.rerender(tree('active'));
        expect(view.container.ownerDocument.querySelector('aside')).not.toHaveAttribute('inert');
    });

    it('covers the minimized pill too', () => {
        setViewport(500, true);
        const view = render(tree('active'));
        fireEvent.click(screen.getByRole('button', { name: 'open' }));
        fireEvent.click(screen.getByRole('button', { name: 'minimize' }));
        view.rerender(tree('signed-out'));
        const pill = view.container.ownerDocument.querySelector('button.fixed') as HTMLElement;
        expect(pill).toHaveAttribute('inert');
        expect(pill).toHaveAttribute('aria-hidden', 'true');
    });

    it('does not make the page inert behind a blocked mobile sheet, so the re-auth dialog stays usable', () => {
        setViewport(500, true);
        const view = render(tree('active'));
        fireEvent.click(screen.getByRole('button', { name: 'open' }));
        const content = document.getElementById(ASSISTANT_INERT_TARGET_ID) as HTMLElement;
        expect(content).toHaveAttribute('inert');
        view.rerender(tree('reauth-required'));
        expect(content).not.toHaveAttribute('inert');
    });

    it.each<SessionGateStatus>(['reauth-required', 'signed-out'])('refuses open, toggle and the shortcut while %s', status => {
        render(tree(status));
        fireEvent.click(screen.getByRole('button', { name: 'open' }));
        expect(screen.getByTestId('state')).toHaveTextContent('closed');
        fireEvent.click(screen.getByRole('button', { name: 'toggle' }));
        expect(screen.getByTestId('state')).toHaveTextContent('closed');
        act(() => {
            fireEvent.keyDown(window, { code: 'Space', key: ' ', ctrlKey: true, shiftKey: true });
        });
        expect(screen.getByTestId('state')).toHaveTextContent('closed');
    });

    it('opens again once the gate is active', () => {
        const view = render(tree('reauth-required'));
        fireEvent.click(screen.getByRole('button', { name: 'open' }));
        expect(screen.getByTestId('state')).toHaveTextContent('closed');
        view.rerender(tree('active'));
        fireEvent.click(screen.getByRole('button', { name: 'open' }));
        expect(screen.getByTestId('state')).toHaveTextContent('open');
    });

    it('stacks the re-auth dialog above the panel (z-50)', () => {
        render(
            <ReauthModal
                isOpen
                mode="expired"
                targetAccount="root"
                rucioIdentity="ddmlab"
                shortVOName="def"
                onClose={jest.fn()}
                onSuccess={jest.fn()}
            />,
        );
        const dialog = screen.getByRole('dialog');
        const overlay = dialog.parentElement as HTMLElement;
        const z = (el: HTMLElement) => Number(/z-\[(\d+)\]/.exec(el.className)?.[1] ?? /\bz-(\d+)\b/.exec(el.className)?.[1] ?? 0);
        expect(z(overlay)).toBeGreaterThan(50);
        expect(z(dialog)).toBeGreaterThan(50);
    });
});
