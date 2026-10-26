import { NextRequest } from 'next/server';

// jsdom doesn't ship Response.json, which NextResponse.json relies on.
if (typeof (global.Response as { json?: unknown }).json !== 'function') {
    (global.Response as unknown as { json: (data: unknown, init?: ResponseInit) => Response }).json = function jsonPolyfill(
        data: unknown,
        init?: ResponseInit,
    ): Response {
        const headers = new Headers(init?.headers);
        headers.set('content-type', 'application/json');
        return new Response(JSON.stringify(data), { ...init, headers });
    };
}

import { auth } from '@/lib/infrastructure/auth/auth';
import { GET, POST } from '@/app/api/assistant/llm/[...path]/route';
import { relayRateLimiter } from '@/lib/infrastructure/assistant/relay-rate-limiter';
import { RELAY_MAX_BODY_BYTES } from '@/lib/infrastructure/assistant/llm-relay';

const authMock = auth as unknown as jest.Mock;
const UPSTREAM_STREAM = 'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n';
const ENV_KEYS = [
    'FEATURE_ASSISTANT',
    'ASSISTANT_DEFAULT_PROVIDER_KIND',
    'ASSISTANT_DEFAULT_BASE_URL',
    'ASSISTANT_DEFAULT_API_KEY',
    'ASSISTANT_DEFAULT_MODEL',
    'ASSISTANT_RELAY_RATE_LIMIT',
];

const signInAs = (account: string) =>
    authMock.mockResolvedValue({
        user: {
            rucioIdentity: account,
            rucioAccount: account,
            rucioVO: 'def',
            role: 'user',
            isLoggedIn: true,
            rucioAuthToken: 'rucio-secret-token',
            rucioAuthTokenExpires: '2099-01-01T00:00:00Z',
        },
        allUsers: [],
    });

const ctx = (...path: string[]) => ({ params: Promise.resolve({ path }) });
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
    new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const COMPLETIONS_URL = 'http://localhost/api/assistant/llm/chat/completions';
const BODY = { model: 'gpt-oss-120b', stream: true, messages: [{ role: 'user', content: 'hello' }] };

let upstream: jest.Mock;
const lastCall = () => upstream.mock.calls[upstream.mock.calls.length - 1] as [string, RequestInit];
const sentHeaders = () => new Headers(lastCall()[1].headers);

describe('/api/assistant/llm/[...path]', () => {
    beforeEach(() => {
        relayRateLimiter.reset();
        process.env.FEATURE_ASSISTANT = 'true';
        process.env.ASSISTANT_DEFAULT_PROVIDER_KIND = 'openai-compatible';
        process.env.ASSISTANT_DEFAULT_BASE_URL = 'https://llm.example.org/v1/';
        process.env.ASSISTANT_DEFAULT_API_KEY = 'sk-operator-secret';
        process.env.ASSISTANT_DEFAULT_MODEL = 'gpt-oss-120b';
        signInAs('jdoe');
        upstream = jest.fn(async () => new Response(UPSTREAM_STREAM, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
        global.fetch = upstream as unknown as typeof fetch;
    });

    afterEach(() => {
        ENV_KEYS.forEach(key => {
            delete process.env[key];
        });
        authMock.mockResolvedValue(null);
        jest.restoreAllMocks();
    });

    it('returns 404 while the assistant flag is off', async () => {
        delete process.env.FEATURE_ASSISTANT;
        const res = await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'));
        expect(res.status).toBe(404);
        expect(upstream).not.toHaveBeenCalled();
    });

    it('returns 401 without a session', async () => {
        authMock.mockResolvedValue(null);
        const res = await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'));
        expect(res.status).toBe(401);
        expect(upstream).not.toHaveBeenCalled();
    });

    it('returns 404 when no operator default is configured', async () => {
        delete process.env.ASSISTANT_DEFAULT_BASE_URL;
        expect((await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'))).status).toBe(404);
        expect(upstream).not.toHaveBeenCalled();
    });

    it.each([[['v1', 'embeddings']], [['..', '..', 'admin']], [['chat', 'completions', 'extra']], [['v1', 'messages']]])(
        'returns 404 for the subpath %p',
        async path => {
            const res = await POST(post(`http://localhost/api/assistant/llm/${path.join('/')}`, BODY), ctx(...path));
            expect(res.status).toBe(404);
            expect(upstream).not.toHaveBeenCalled();
        },
    );

    it('returns 405 for the wrong method', async () => {
        const res = await GET(new NextRequest(COMPLETIONS_URL), ctx('chat', 'completions'));
        expect(res.status).toBe(405);
        expect(res.headers.get('allow')).toBe('POST');
    });

    it('returns 415 for a non-JSON body', async () => {
        const res = await POST(post(COMPLETIONS_URL, BODY, { 'content-type': 'text/plain' }), ctx('chat', 'completions'));
        expect(res.status).toBe(415);
        expect(upstream).not.toHaveBeenCalled();
    });

    it('returns 413 for an oversized body', async () => {
        const big = { ...BODY, messages: [{ role: 'user', content: 'x'.repeat(RELAY_MAX_BODY_BYTES) }] };
        expect((await POST(post(COMPLETIONS_URL, big), ctx('chat', 'completions'))).status).toBe(413);
        expect(upstream).not.toHaveBeenCalled();
    });

    it('forwards the body to the env upstream with the operator key', async () => {
        const res = await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'));
        expect(res.status).toBe(200);
        const [url, init] = lastCall();
        expect(url).toBe('https://llm.example.org/v1/chat/completions');
        expect(init.method).toBe('POST');
        expect(init.body).toBe(JSON.stringify(BODY));
        expect(init.redirect).toBe('manual');
        expect(sentHeaders().get('authorization')).toBe('Bearer sk-operator-secret');
        expect(sentHeaders().get('content-type')).toBe('application/json');
    });

    it('strips client credentials, cookies and SDK headers', async () => {
        await POST(
            post(COMPLETIONS_URL, BODY, {
                authorization: 'Bearer sk-client-dummy',
                'x-api-key': 'client-key',
                cookie: 'authjs.session-token=abc',
                'x-stainless-os': 'Linux',
                'anthropic-dangerous-direct-browser-access': 'true',
            }),
            ctx('chat', 'completions'),
        );
        const headers = sentHeaders();
        expect(headers.get('authorization')).toBe('Bearer sk-operator-secret');
        expect(headers.has('x-api-key')).toBe(false);
        expect(headers.has('cookie')).toBe(false);
        expect(headers.has('x-stainless-os')).toBe(false);
        expect(headers.has('anthropic-dangerous-direct-browser-access')).toBe(false);
    });

    it('never sends the Rucio token upstream', async () => {
        await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'));
        const [, init] = lastCall();
        const everything = JSON.stringify(Array.from(new Headers(init.headers).entries())) + String(init.body);
        expect(everything).not.toContain('rucio-secret-token');
    });

    it('builds the upstream URL from a base URL with a trailing slash', async () => {
        process.env.ASSISTANT_DEFAULT_BASE_URL = 'https://llm.example.org/v1///';
        await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'));
        expect(lastCall()[0]).toBe('https://llm.example.org/v1/chat/completions');
    });

    it('drops a query string and hash from the base URL', async () => {
        process.env.ASSISTANT_DEFAULT_BASE_URL = 'https://llm.example.org/v1/?api-version=1&x=y#frag';
        await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'));
        expect(lastCall()[0]).toBe('https://llm.example.org/v1/chat/completions');
    });

    it('never derives the upstream URL from the request', async () => {
        await POST(
            post('http://evil.example/api/assistant/llm/chat/completions?base=http://169.254.169.254', BODY, {
                'x-forwarded-host': 'evil.example',
                'x-forwarded-proto': 'http',
            }),
            ctx('chat', 'completions'),
        );
        expect(lastCall()[0]).toBe('https://llm.example.org/v1/chat/completions');
    });

    it('streams the upstream body back unchanged', async () => {
        const res = await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'));
        expect(res.headers.get('content-type')).toBe('text/event-stream');
        expect(res.headers.get('cache-control')).toBe('no-store');
        await expect(res.text()).resolves.toBe(UPSTREAM_STREAM);
    });

    it('passes upstream errors through', async () => {
        upstream.mockResolvedValueOnce(
            new Response('{"error":{"message":"model not found"}}', { status: 404, headers: { 'content-type': 'application/json' } }),
        );
        const res = await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'));
        expect(res.status).toBe(404);
        await expect(res.text()).resolves.toBe('{"error":{"message":"model not found"}}');
    });

    it('relays GET models without a body', async () => {
        upstream.mockResolvedValueOnce(new Response('{"data":[]}', { status: 200, headers: { 'content-type': 'application/json' } }));
        const res = await GET(new NextRequest('http://localhost/api/assistant/llm/models'), ctx('models'));
        expect(res.status).toBe(200);
        const [url, init] = lastCall();
        expect(url).toBe('https://llm.example.org/v1/models');
        expect(init.method).toBe('GET');
        expect(init.body).toBeUndefined();
    });

    it('injects the Anthropic key and version for an anthropic upstream', async () => {
        process.env.ASSISTANT_DEFAULT_PROVIDER_KIND = 'anthropic';
        process.env.ASSISTANT_DEFAULT_BASE_URL = 'https://api.anthropic.com';
        const res = await POST(post('http://localhost/api/assistant/llm/v1/messages', BODY, { 'x-api-key': 'client-key' }), ctx('v1', 'messages'));
        expect(res.status).toBe(200);
        expect(lastCall()[0]).toBe('https://api.anthropic.com/v1/messages');
        const headers = sentHeaders();
        expect(headers.get('x-api-key')).toBe('sk-operator-secret');
        expect(headers.get('anthropic-version')).toBe('2023-06-01');
        expect(headers.has('authorization')).toBe(false);
        expect((await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'))).status).toBe(404);
    });

    it('rate limits per session', async () => {
        process.env.ASSISTANT_RELAY_RATE_LIMIT = '2';
        const statuses: number[] = [];
        for (let i = 0; i < 3; i++) {
            statuses.push((await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'))).status);
        }
        expect(statuses).toEqual([200, 200, 429]);
        expect(upstream).toHaveBeenCalledTimes(2);
        signInAs('alice');
        expect((await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'))).status).toBe(200);
    });

    it('sends Retry-After when rate limited', async () => {
        process.env.ASSISTANT_RELAY_RATE_LIMIT = '1';
        await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'));
        const res = await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'));
        expect(res.status).toBe(429);
        expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    });

    it('answers 502 when the upstream is unreachable and logs no body or key', async () => {
        const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        upstream.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
        const res = await POST(
            post(COMPLETIONS_URL, { ...BODY, messages: [{ role: 'user', content: 'top secret prompt' }] }),
            ctx('chat', 'completions'),
        );
        expect(res.status).toBe(502);
        const logged = JSON.stringify(error.mock.calls);
        expect(logged).not.toContain('top secret prompt');
        expect(logged).not.toContain('sk-operator-secret');
    });

    it('does not follow upstream redirects', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        upstream.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }));
        expect((await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'))).status).toBe(502);
    });
});
