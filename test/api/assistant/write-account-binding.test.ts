/**
 * A write approved as one account must not run as another: when a request carries
 * x-rucio-assistant-account, executeAuthenticatedController compares it with the session account
 * before the controller runs.
 */
if (typeof (global.Response as { json?: unknown }).json !== 'function') {
    (global.Response as unknown as { json: (data: unknown, init?: ResponseInit) => Response }).json = (data, init) =>
        new Response(JSON.stringify(data), { ...init, headers: { 'content-type': 'application/json' } });
}

const mockHeaders = jest.fn();
jest.mock('next/headers', () => ({ headers: () => mockHeaders() }));

const sessionUser = { isLoggedIn: true, rucioAccount: 'jdoe', rucioVO: 'def', rucioAuthToken: 'tok' };
jest.mock('@/lib/infrastructure/auth/nextauth-session-utils', () => ({
    getSession: async () => ({ user: sessionUser }),
    withAuthenticatedSession: async (handler: (user: unknown, token: string) => Promise<unknown>) => handler(sessionUser, 'tok'),
}));

import { executeAuthenticatedController } from '@/lib/infrastructure/adapters/app-router-controller-adapter';
import { ACCOUNT_MISMATCH_MESSAGE, ASSISTANT_ACCOUNT_HEADER } from '@/lib/infrastructure/assistant/account-binding';

function fakeController() {
    return {
        execute: jest.fn(async (params: { response: { status(c: number): unknown; json(d: unknown): unknown } }) => {
            params.response.status(200);
            params.response.json({ status: 'success' });
        }),
    };
}

const withHeader = (value: string | null) =>
    mockHeaders.mockResolvedValue({ get: (name: string) => (name === ASSISTANT_ACCOUNT_HEADER ? value : null) });

describe('executeAuthenticatedController assistant account binding', () => {
    beforeEach(() => mockHeaders.mockReset());

    it('returns 409 account_mismatch and never calls the controller on a mismatching header', async () => {
        withHeader('other@def');
        const controller = fakeController();
        const res = await executeAuthenticatedController(controller as never, {} as never);
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({ status: 'error', errorType: 'account_mismatch', message: ACCOUNT_MISMATCH_MESSAGE });
        expect(controller.execute).not.toHaveBeenCalled();
    });

    it('proceeds on a matching header', async () => {
        withHeader('jdoe@def');
        const controller = fakeController();
        const res = await executeAuthenticatedController(controller as never, {} as never);
        expect(res.status).toBe(200);
        expect(controller.execute).toHaveBeenCalledTimes(1);
    });

    it('proceeds as before without the header', async () => {
        withHeader(null);
        const controller = fakeController();
        const res = await executeAuthenticatedController(controller as never, {} as never);
        expect(res.status).toBe(200);
        expect(controller.execute).toHaveBeenCalledTimes(1);
    });

    it('proceeds when request headers are unavailable', async () => {
        mockHeaders.mockRejectedValue(new Error('outside request scope'));
        const controller = fakeController();
        const res = await executeAuthenticatedController(controller as never, {} as never);
        expect(res.status).toBe(200);
    });
});
