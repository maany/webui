/**
 * @jest-environment jsdom
 *
 * The session gate published by SessionMonitorProvider: `active` by default, `reauth-required` while the
 * userpass re-auth dialog is open, `signed-out` on the automatic sign-out paths, `active` again after re-auth.
 */

jest.mock('next-auth/react');
jest.mock('next/navigation');
jest.mock('@/lib/infrastructure/auth/navigate');

import React from 'react';
import { render, act, cleanup, screen, fireEvent } from '@testing-library/react';
import { useSession, signIn, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { SessionMonitorProvider } from '@/lib/infrastructure/auth/session-monitor';
import { useSessionGate } from '@/lib/infrastructure/auth/session-gate';
import { AuthType, Role } from '@/lib/core/entity/auth-models';
import type { SessionUser } from '@/lib/core/entity/auth-models';

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
    return {
        rucioIdentity: 'ddmlab',
        rucioAccount: 'root',
        rucioVO: 'def',
        rucioAuthToken: 'token-abc',
        rucioAuthTokenExpires: new Date(Date.now() + 90_000).toISOString(),
        rucioAuthType: AuthType.USERPASS,
        rucioOIDCProvider: 'cern',
        role: Role.USER,
        isLoggedIn: true,
        ...overrides,
    };
}

function GateProbe() {
    return <span data-testid="gate">{useSessionGate().status}</span>;
}

function mockSession(user: SessionUser) {
    (useSession as jest.Mock).mockReturnValue({ data: { user }, status: 'authenticated', update: jest.fn().mockResolvedValue(undefined) });
}

function renderMonitor() {
    return render(
        <SessionMonitorProvider>
            <GateProbe />
        </SessionMonitorProvider>,
    );
}

describe('session gate', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        (usePathname as jest.Mock).mockReturnValue('/dashboard');
        (signOut as jest.Mock).mockResolvedValue(undefined);
        fetchMock.resetMocks();
    });

    afterEach(() => {
        jest.useRealTimers();
        cleanup();
        jest.clearAllMocks();
    });

    it('is active outside a provider', () => {
        render(<GateProbe />);
        expect(screen.getByTestId('gate')).toHaveTextContent('active');
    });

    it('is active while the session is healthy', () => {
        mockSession(makeUser());
        renderMonitor();
        expect(screen.getByTestId('gate')).toHaveTextContent('active');
    });

    it('is reauth-required while the userpass re-auth dialog is open', async () => {
        mockSession(makeUser());
        renderMonitor();
        await act(async () => {
            jest.advanceTimersByTime(30_001);
        });
        expect(await screen.findByRole('heading', { name: /session expired/i })).toBeInTheDocument();
        expect(screen.getByTestId('gate')).toHaveTextContent('reauth-required');
    });

    it('is signed-out when an x509 refresh fails', async () => {
        mockSession(makeUser({ rucioAuthType: AuthType.x509 }));
        fetchMock.mockResponse(JSON.stringify({ success: false }), { status: 401 });
        renderMonitor();
        await act(async () => {
            jest.advanceTimersByTime(30_001);
        });
        expect(screen.getByTestId('gate')).toHaveTextContent('signed-out');
    });

    it('is signed-out when the re-auth dialog is cancelled', async () => {
        mockSession(makeUser());
        renderMonitor();
        await act(async () => {
            jest.advanceTimersByTime(30_001);
        });
        fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
        expect(screen.getByTestId('gate')).toHaveTextContent('signed-out');
    });

    it('stays blocked after a successful re-auth until the page reloads', async () => {
        mockSession(makeUser());
        // jsdom cannot redefine window.location; its reload only reports "not implemented", which is silenced here.
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        fetchMock.mockResponse(
            JSON.stringify({
                status: 'success',
                rucioAuthToken: 't',
                rucioAccount: 'root',
                rucioAuthTokenExpires: new Date(Date.now() + 3_600_000).toISOString(),
            }),
        );
        (signIn as jest.Mock).mockResolvedValue({ ok: true });
        renderMonitor();
        await act(async () => {
            jest.advanceTimersByTime(30_001);
        });
        expect(screen.getByTestId('gate')).toHaveTextContent('reauth-required');
        fireEvent.change(await screen.findByLabelText(/^Password$/i), { target: { value: 'secret' } });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        });
        // The dialog stays up until the reload brings a fresh monitor (and an active gate) back.
        expect(screen.getByTestId('gate')).toHaveTextContent('reauth-required');
        expect(screen.getByRole('heading', { name: /session expired/i })).toBeInTheDocument();
        consoleError.mockRestore();
    });

    it('is signed-out on natural expiry (unauthenticated after authenticated)', async () => {
        mockSession(makeUser({ rucioAuthTokenExpires: new Date(Date.now() + 3_600_000).toISOString() }));
        const view = renderMonitor();
        (useSession as jest.Mock).mockReturnValue({ data: null, status: 'unauthenticated', update: jest.fn() });
        await act(async () => {
            view.rerender(
                <SessionMonitorProvider>
                    <GateProbe />
                </SessionMonitorProvider>,
            );
        });
        expect(screen.getByTestId('gate')).toHaveTextContent('signed-out');
    });

    it('is signed-out when a userpass session expires with no identity to re-auth', async () => {
        mockSession(makeUser({ rucioIdentity: undefined as unknown as string }));
        renderMonitor();
        await act(async () => {
            jest.advanceTimersByTime(30_001);
        });
        expect(screen.queryByRole('heading', { name: /session expired/i })).toBeNull();
        expect(screen.getByTestId('gate')).toHaveTextContent('signed-out');
    });
});
