/**
 * @jest-environment jsdom
 *
 * manualSignOut() runs the registered sign-out hooks (Rucio bot "clear on logout")
 * before NextAuth signs out and before the redirect.
 */

jest.mock('next-auth/react');
jest.mock('next/navigation');
jest.mock('@/lib/infrastructure/auth/navigate');
jest.mock('@/lib/infrastructure/auth/sign-out-hooks', () => ({ runSignOutHooks: jest.fn() }));

import React from 'react';
import { act, render } from '@testing-library/react';
import { signOut, useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { navigateTo } from '@/lib/infrastructure/auth/navigate';
import { SessionMonitorProvider, useSessionMonitor } from '@/lib/infrastructure/auth/session-monitor';
import { runSignOutHooks } from '@/lib/infrastructure/auth/sign-out-hooks';

function Consumer({ onReady }: { onReady: (signOutNow: () => Promise<void>) => void }) {
    const { manualSignOut } = useSessionMonitor();
    React.useEffect(() => {
        onReady(manualSignOut);
    }, [manualSignOut, onReady]);
    return null;
}

describe('SessionMonitorProvider sign-out hooks', () => {
    it('runs the hooks before signOut and the redirect', async () => {
        const order: string[] = [];
        (useSession as jest.Mock).mockReturnValue({ data: null, status: 'unauthenticated', update: jest.fn() });
        (usePathname as jest.Mock).mockReturnValue('/dashboard');
        (runSignOutHooks as jest.Mock).mockImplementation(async () => {
            order.push('hooks');
        });
        (signOut as jest.Mock).mockImplementation(async () => {
            order.push('signOut');
        });
        (navigateTo as jest.Mock).mockImplementation(() => {
            order.push('navigate');
        });
        let manualSignOut: (() => Promise<void>) | undefined;
        render(
            <SessionMonitorProvider>
                <Consumer
                    onReady={fn => {
                        manualSignOut = fn;
                    }}
                />
            </SessionMonitorProvider>,
        );
        await act(async () => {
            await manualSignOut?.();
        });
        expect(order).toEqual(['hooks', 'signOut', 'navigate']);
    });
});

describe('SessionMonitorProvider automatic sign-out hooks', () => {
    it('runs the hooks with a 1000 ms timeout before signOut when the token is already expired', async () => {
        const order: string[] = [];
        (useSession as jest.Mock).mockReturnValue({
            data: {
                user: { rucioAuthTokenExpires: new Date(Date.now() - 60_000).toISOString(), rucioAuthType: 'userpass' },
            },
            status: 'authenticated',
            update: jest.fn(),
        });
        (usePathname as jest.Mock).mockReturnValue('/dashboard');
        let releaseHooks: () => void = () => undefined;
        (runSignOutHooks as jest.Mock).mockReset().mockImplementation(async () => {
            order.push('hooks');
            await new Promise<void>(resolve => {
                releaseHooks = resolve;
            });
        });
        (signOut as jest.Mock).mockReset().mockImplementation(async () => {
            order.push('signOut');
        });
        (navigateTo as jest.Mock).mockReset().mockImplementation(() => {
            order.push('navigate');
        });
        await act(async () => {
            render(
                <SessionMonitorProvider>
                    <div />
                </SessionMonitorProvider>,
            );
        });
        expect(runSignOutHooks).toHaveBeenCalledWith(1000);
        expect(signOut).not.toHaveBeenCalled();
        await act(async () => {
            releaseHooks();
        });
        expect(order.slice(0, 3)).toEqual(['hooks', 'signOut', 'navigate']);
    });
});
