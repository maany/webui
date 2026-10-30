import { NextRequest } from 'next/server';

const mockSignOut = jest.fn(async () => undefined);
jest.mock('@/lib/infrastructure/auth/auth', () => ({ signOut: () => mockSignOut() }));

import { GET, POST } from '@/app/api/auth/logout/route';

const call = (handler: typeof GET, query: string) => handler(new NextRequest(`https://webui.example/api/auth/logout${query}`));

describe.each([
    ['GET', GET],
    ['POST', POST],
])('%s /api/auth/logout redirect target', (_method, handler) => {
    it('defaults to the login page', async () => {
        const res = await call(handler, '');
        expect(res.headers.get('location')).toBe('https://webui.example/auth/login');
    });

    it('follows a same-origin callback path', async () => {
        const res = await call(handler, '?callbackUrl=%2Fauth%2Flogin%3Fx%3D1');
        expect(res.headers.get('location')).toBe('https://webui.example/auth/login?x=1');
    });

    it.each([
        ['absolute url', 'https%3A%2F%2Fevil.example%2Fx'],
        ['protocol-relative', '%2F%2Fevil.example'],
        ['backslash', '%2F%5Cevil.example'],
        ['tab between the slashes', '%2F%09%2Fevil.example'],
    ])('never sends the user off-site (%s)', async (_name, query) => {
        const res = await call(handler, `?callbackUrl=${query}`);
        expect(new URL(res.headers.get('location') ?? '').origin).toBe('https://webui.example');
    });
});
