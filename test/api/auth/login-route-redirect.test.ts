import { NextRequest } from 'next/server';

const mockGetSession = jest.fn();
jest.mock('@/lib/infrastructure/auth/nextauth-session-utils', () => ({ getSession: () => mockGetSession() }));
jest.mock('@/lib/infrastructure/ioc/container-config', () => ({ __esModule: true, default: { get: jest.fn() } }));

import { GET } from '@/app/api/auth/login/route';

const get = (query: string) => GET(new NextRequest(`https://webui.example/api/auth/login${query}`));

describe('GET /api/auth/login redirect target', () => {
    it('sends a signed-in user to a same-origin callback path', async () => {
        mockGetSession.mockResolvedValue({ user: { isLoggedIn: true } });
        const res = await get('?callbackUrl=%2Fdid%2Fpage');
        expect(res.headers.get('location')).toBe('https://webui.example/did/page');
    });

    it.each([
        ['absolute url', 'https%3A%2F%2Fevil.example%2Fx'],
        ['protocol-relative', '%2F%2Fevil.example'],
        ['backslash', '%2F%5Cevil.example'],
    ])('never sends a signed-in user off-site (%s)', async (_name, query) => {
        mockGetSession.mockResolvedValue({ user: { isLoggedIn: true } });
        const res = await get(`?callbackUrl=${query}`);
        expect(new URL(res.headers.get('location') ?? '').origin).toBe('https://webui.example');
    });

    it('defaults a signed-in user to the dashboard', async () => {
        mockGetSession.mockResolvedValue({ user: { isLoggedIn: true } });
        const res = await get('');
        expect(res.headers.get('location')).toBe('https://webui.example/dashboard');
    });
});
