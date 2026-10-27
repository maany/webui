/**
 * The site header route is the one assistant read route that does not use executeAuthenticatedController.
 * It must refuse a request whose x-rucio-assistant-account header names a different account than the session's.
 */
if (typeof (global.Response as { json?: unknown }).json !== 'function') {
    (global.Response as unknown as { json: (data: unknown, init?: ResponseInit) => Response }).json = (data, init) =>
        new Response(JSON.stringify(data), { ...init, headers: { 'content-type': 'application/json' } });
}

const mockHeaders = jest.fn();
jest.mock('next/headers', () => ({ headers: () => mockHeaders() }));

const sessionUser = { isLoggedIn: true, rucioAccount: 'jdoe', rucioVO: 'def', rucioAuthToken: 'tok' };
jest.mock('@/lib/infrastructure/auth/nextauth-session-utils', () => ({
    getSession: async () => ({ user: sessionUser, allUsers: [] }),
    withAuthenticatedSession: async (handler: (user: unknown, token: string) => Promise<unknown>) => handler(sessionUser, 'tok'),
}));

const execute = jest.fn(async (params: { response: { status(c: number): unknown; json(d: unknown): unknown } }) => {
    params.response.status(200);
    params.response.json({ activeAccount: 'jdoe' });
});
jest.mock('@/lib/infrastructure/ioc/container-config', () => ({ __esModule: true, default: { get: () => ({ execute }) } }));
jest.mock('@/lib/infrastructure/ioc/ioc-symbols-controllers', () => ({ __esModule: true, default: { GET_SITE_HEADER: Symbol('site-header') } }));

import { GET } from '@/app/api/feature/get-site-header/route';
import { ACCOUNT_MISMATCH_MESSAGE, ASSISTANT_ACCOUNT_HEADER } from '@/lib/infrastructure/assistant/account-binding';

const withHeader = (value: string | null) =>
    mockHeaders.mockResolvedValue({ get: (name: string) => (name === ASSISTANT_ACCOUNT_HEADER ? value : null) });

describe('get-site-header assistant account binding', () => {
    beforeEach(() => {
        mockHeaders.mockReset();
        execute.mockClear();
    });

    it('returns 409 account_mismatch and never calls the controller on a mismatching header', async () => {
        withHeader('other@def');
        const res = await GET();
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({ status: 'error', errorType: 'account_mismatch', message: ACCOUNT_MISMATCH_MESSAGE });
        expect(execute).not.toHaveBeenCalled();
    });

    it('proceeds on a matching header', async () => {
        withHeader('jdoe@def');
        const res = await GET();
        expect(res.status).toBe(200);
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('proceeds without the header', async () => {
        withHeader(null);
        const res = await GET();
        expect(res.status).toBe(200);
    });
});
