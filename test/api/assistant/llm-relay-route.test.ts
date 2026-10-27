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
import { relayRateLimiter, relayStreamLimiter } from '@/lib/infrastructure/assistant/relay-rate-limiter';
import { RELAY_MAX_BODY_BYTES, RELAY_MAX_RESPONSE_BYTES, guardBody, relayLlmRequest } from '@/lib/infrastructure/assistant/llm-relay';

const authMock = auth as unknown as jest.Mock;
const UPSTREAM_STREAM = 'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n';
const ENV_KEYS = [
    'FEATURE_ASSISTANT',
    'ASSISTANT_DEFAULT_PROVIDER_KIND',
    'ASSISTANT_DEFAULT_BASE_URL',
    'ASSISTANT_DEFAULT_API_KEY',
    'ASSISTANT_DEFAULT_MODEL',
    'ASSISTANT_RELAY_RATE_LIMIT',
    'ASSISTANT_LLM_UPSTREAM_TIMEOUT_MS',
    'ASSISTANT_LLM_UPSTREAM_MAX_MS',
    'ASSISTANT_LLM_MAX_CONCURRENT_STREAMS',
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
        relayStreamLimiter.reset();
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

    it.each([
        [['v1', 'embeddings']],
        [['..', '..', 'admin']],
        [['chat', 'completions', 'extra']],
        [['v1', 'messages']],
        [['__proto__']],
        [['constructor']],
    ])('returns 404 for the subpath %p', async path => {
        const res = await POST(post(`http://localhost/api/assistant/llm/${path.join('/')}`, BODY), ctx(...path));
        expect(res.status).toBe(404);
        expect(upstream).not.toHaveBeenCalled();
    });

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

    it('returns 413 when the declared content-length exceeds the cap', async () => {
        const res = await POST(post(COMPLETIONS_URL, BODY, { 'content-length': String(RELAY_MAX_BODY_BYTES + 1) }), ctx('chat', 'completions'));
        expect(res.status).toBe(413);
        expect(upstream).not.toHaveBeenCalled();
    });

    it('returns 413 for a body of exactly the cap', async () => {
        const req = new NextRequest(COMPLETIONS_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: 'x'.repeat(RELAY_MAX_BODY_BYTES),
        });
        expect((await POST(req, ctx('chat', 'completions'))).status).toBe(413);
        expect(upstream).not.toHaveBeenCalled();
    });

    it('returns 415 when application/json only appears in a parameter', async () => {
        const res = await POST(post(COMPLETIONS_URL, BODY, { 'content-type': 'text/plain; x=application/json' }), ctx('chat', 'completions'));
        expect(res.status).toBe(415);
        expect(upstream).not.toHaveBeenCalled();
    });

    it('accepts application/json with a charset parameter', async () => {
        const res = await POST(post(COMPLETIONS_URL, BODY, { 'content-type': 'Application/JSON; charset=utf-8' }), ctx('chat', 'completions'));
        expect(res.status).toBe(200);
    });

    it('does not forward upstream set-cookie or www-authenticate headers', async () => {
        upstream.mockResolvedValueOnce(
            new Response('{}', {
                status: 401,
                headers: { 'content-type': 'application/json', 'set-cookie': 'a=b', 'www-authenticate': 'Basic realm="x"' },
            }),
        );
        const res = await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'));
        expect(res.headers.has('set-cookie')).toBe(false);
        expect(res.headers.has('www-authenticate')).toBe(false);
    });

    it('cancels the upstream body on a redirect', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const cancel = jest.fn(async () => undefined);
        const redirect = { status: 302, headers: new Headers({ location: 'http://x/' }), body: { cancel } };
        upstream.mockResolvedValueOnce(redirect as unknown as Response);
        expect((await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'))).status).toBe(502);
        expect(cancel).toHaveBeenCalled();
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

    describe('concurrent stream cap', () => {
        const hang = () =>
            jest.fn(
                (_url: string, init: RequestInit) =>
                    new Promise<Response>((_resolve, reject) => {
                        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
                    }),
            );
        const tick = () => new Promise(resolve => setTimeout(resolve, 10));
        // The jsdom Response polyfill exposes no web stream body, so hand the relay a minimal upstream that has one.
        const streamingUpstream = (init: RequestInit, firstChunk: boolean) =>
            ({
                status: 200,
                headers: new Headers(),
                body: new ReadableStream<Uint8Array>({
                    start(c) {
                        if (firstChunk) c.enqueue(new Uint8Array(1));
                        init.signal?.addEventListener('abort', () => c.error(new Error('aborted')));
                    },
                }),
            } as unknown as Response);

        it('answers 429 too_many_streams once the account has the maximum in flight', async () => {
            process.env.ASSISTANT_LLM_MAX_CONCURRENT_STREAMS = '2';
            jest.spyOn(console, 'error').mockImplementation(() => undefined);
            const hung = hang();
            global.fetch = hung as unknown as typeof fetch;
            const abort = new AbortController();
            const mk = () =>
                new NextRequest(COMPLETIONS_URL, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(BODY),
                    signal: abort.signal,
                });
            const first = POST(mk(), ctx('chat', 'completions'));
            const second = POST(mk(), ctx('chat', 'completions'));
            await tick();
            const res = await POST(mk(), ctx('chat', 'completions'));
            expect(res.status).toBe(429);
            expect(await res.json()).toEqual({
                error: 'too_many_streams',
                message: 'Too many assistant replies are running for this account. Wait for one to finish and try again.',
            });
            expect(hung).toHaveBeenCalledTimes(2);
            abort.abort();
            await Promise.all([first, second]);
        });

        it('counts accounts separately', async () => {
            process.env.ASSISTANT_LLM_MAX_CONCURRENT_STREAMS = '1';
            jest.spyOn(console, 'error').mockImplementation(() => undefined);
            global.fetch = hang() as unknown as typeof fetch;
            const abort = new AbortController();
            const mk = () =>
                new NextRequest(COMPLETIONS_URL, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(BODY),
                    signal: abort.signal,
                });
            const first = POST(mk(), ctx('chat', 'completions'));
            await tick();
            signInAs('alice');
            global.fetch = upstream as unknown as typeof fetch;
            expect((await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'))).status).toBe(200);
            abort.abort();
            await first;
        });

        it('releases the slot after a completed response', async () => {
            process.env.ASSISTANT_LLM_MAX_CONCURRENT_STREAMS = '1';
            const statuses: number[] = [];
            for (let i = 0; i < 3; i++) statuses.push((await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'))).status);
            expect(statuses).toEqual([200, 200, 200]);
        });

        it('releases the slot after an upstream error and an upstream non-OK response', async () => {
            process.env.ASSISTANT_LLM_MAX_CONCURRENT_STREAMS = '1';
            jest.spyOn(console, 'error').mockImplementation(() => undefined);
            upstream.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
            expect((await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'))).status).toBe(502);
            upstream.mockResolvedValueOnce(new Response('{"error":"x"}', { status: 500 }));
            expect((await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'))).status).toBe(500);
            upstream.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://evil.example' } }));
            expect((await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'))).status).toBe(502);
            expect((await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'))).status).toBe(200);
        });

        it('releases the slot when the client aborts before headers', async () => {
            process.env.ASSISTANT_LLM_MAX_CONCURRENT_STREAMS = '1';
            jest.spyOn(console, 'error').mockImplementation(() => undefined);
            global.fetch = hang() as unknown as typeof fetch;
            const abort = new AbortController();
            const pending = POST(
                new NextRequest(COMPLETIONS_URL, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(BODY),
                    signal: abort.signal,
                }),
                ctx('chat', 'completions'),
            );
            await tick();
            abort.abort();
            await pending;
            global.fetch = upstream as unknown as typeof fetch;
            expect((await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'))).status).toBe(200);
        });

        it('releases the slot when the header timeout or the total deadline passes', async () => {
            process.env.ASSISTANT_LLM_MAX_CONCURRENT_STREAMS = '1';
            jest.spyOn(console, 'error').mockImplementation(() => undefined);
            global.fetch = hang() as unknown as typeof fetch;
            process.env.ASSISTANT_LLM_UPSTREAM_TIMEOUT_MS = '30';
            expect((await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'))).status).toBe(504);
            delete process.env.ASSISTANT_LLM_UPSTREAM_TIMEOUT_MS;
            process.env.ASSISTANT_LLM_UPSTREAM_MAX_MS = '30';
            expect((await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'))).status).toBe(504);
            global.fetch = upstream as unknown as typeof fetch;
            delete process.env.ASSISTANT_LLM_UPSTREAM_MAX_MS;
            expect((await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'))).status).toBe(200);
        });

        it('releases the slot when the total deadline fires while the consumer is not pulling', async () => {
            process.env.ASSISTANT_LLM_MAX_CONCURRENT_STREAMS = '1';
            process.env.ASSISTANT_LLM_UPSTREAM_MAX_MS = '40';
            jest.spyOn(console, 'error').mockImplementation(() => undefined);
            global.fetch = (async (_url: string, init: RequestInit) => streamingUpstream(init, true)) as unknown as typeof fetch;
            const res = await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'));
            expect(res.status).toBe(200);
            // never read the body: no pull is pending when the deadline fires
            await new Promise(resolve => setTimeout(resolve, 120));
            delete process.env.ASSISTANT_LLM_UPSTREAM_MAX_MS;
            global.fetch = upstream as unknown as typeof fetch;
            expect((await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'))).status).toBe(200);
        });

        it('releases the slot when the client aborts while the consumer is not pulling, and the stream then ends', async () => {
            process.env.ASSISTANT_LLM_MAX_CONCURRENT_STREAMS = '1';
            jest.spyOn(console, 'error').mockImplementation(() => undefined);
            global.fetch = (async (_url: string, init: RequestInit) => streamingUpstream(init, true)) as unknown as typeof fetch;
            const abort = new AbortController();
            const res = await POST(
                new NextRequest(COMPLETIONS_URL, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(BODY),
                    signal: abort.signal,
                }),
                ctx('chat', 'completions'),
            );
            expect(res.status).toBe(200);
            abort.abort();
            await tick();
            global.fetch = upstream as unknown as typeof fetch;
            expect((await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'))).status).toBe(200);
        });

        it('ends the stream on the next read after the deadline fired with no pull pending', async () => {
            const controller = new AbortController();
            const source = new ReadableStream<Uint8Array>({
                pull(c) {
                    c.enqueue(new Uint8Array(1));
                },
            });
            let done = 0;
            const guarded = guardBody(source, 5000, 1 << 20, () => (done += 1), controller.signal);
            await tick();
            controller.abort();
            const reader = guarded.getReader();
            const outcome = await Promise.race([
                (async () => {
                    for (;;) if ((await reader.read()).done) return 'ended';
                })().catch(() => 'errored'),
                new Promise(resolve => setTimeout(() => resolve('hung'), 500)),
            ]);
            expect(['ended', 'errored']).toContain(outcome);
            expect(done).toBe(1);
        });

        it('keeps the deadline listener count bounded across many pulls', async () => {
            const controller = new AbortController();
            const add = jest.spyOn(controller.signal, 'addEventListener');
            const remove = jest.spyOn(controller.signal, 'removeEventListener');
            let n = 0;
            const source = new ReadableStream<Uint8Array>({
                pull(c) {
                    if (n++ < 200) c.enqueue(new Uint8Array(1));
                    else c.close();
                },
            });
            const guarded = guardBody(source, 5000, 1 << 20, () => undefined, controller.signal);
            const reader = guarded.getReader();
            while (!(await reader.read()).done);
            const added = add.mock.calls.filter(c => c[0] === 'abort').length;
            const removed = remove.mock.calls.filter(c => c[0] === 'abort').length;
            expect(added).toBeGreaterThan(100);
            expect(added - removed).toBeLessThanOrEqual(1);
        });

        it('releases the slot when the response body ends, is cancelled by the client, goes idle or hits the cap', async () => {
            const limiter = relayStreamLimiter;
            const cases: Array<(guarded: ReadableStream<Uint8Array>) => Promise<unknown>> = [
                async g => {
                    const r = g.getReader();
                    while (!(await r.read()).done);
                },
                async g => {
                    const r = g.getReader();
                    await r.read();
                    await r.cancel();
                },
            ];
            jest.spyOn(console, 'error').mockImplementation(() => undefined);
            for (const consume of cases) {
                const release = limiter.tryAcquire('k', 1) as () => void;
                const body = new ReadableStream<Uint8Array>({
                    pull(c) {
                        c.enqueue(new Uint8Array(4));
                    },
                });
                let calls = 0;
                const guarded = guardBody(body, 5000, 8, () => {
                    calls += 1;
                    release();
                });
                // the 8 byte cap errors the endless stream for the first case; cancel covers the second
                await consume(guarded).catch(() => undefined);
                expect(calls).toBe(1);
                expect(limiter.tryAcquire('k', 1)).toBeDefined();
                limiter.reset();
            }
        });
    });

    describe('request size and upstream limits', () => {
        const MB = 1024 * 1024;
        // jsdom's Request polyfill buffers bodies, so real web streams are fed to relayLlmRequest through a request-like object.
        const streamRequest = (body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}, signal?: AbortSignal) =>
            ({
                method: 'POST',
                headers: new Headers({ 'content-type': 'application/json', ...headers }),
                body,
                signal: signal ?? new AbortController().signal,
            } as unknown as NextRequest);
        const drain = async (stream: ReadableStream<Uint8Array>) => {
            const reader = stream.getReader();
            let total = 0;
            let errored = false;
            try {
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    total += value.byteLength;
                }
            } catch {
                errored = true;
            }
            return { total, errored };
        };

        it('returns 413 for a chunked body over the cap without buffering the rest', async () => {
            const chunk = new Uint8Array(MB);
            let sent = 0;
            let cancelled = false;
            const stream = new ReadableStream<Uint8Array>({
                pull(controller) {
                    sent += 1;
                    controller.enqueue(chunk);
                    if (sent >= 100) controller.close();
                },
                cancel() {
                    cancelled = true;
                },
            });
            const res = await relayLlmRequest(streamRequest(stream), ['chat', 'completions']);
            expect(res.status).toBe(413);
            expect(upstream).not.toHaveBeenCalled();
            expect(cancelled).toBe(true);
            expect(sent).toBeLessThanOrEqual(RELAY_MAX_BODY_BYTES / MB + 2);
        });

        it.each(['abc', 'NaN', '-5', '1.5'])('rejects a non-numeric or invalid content-length %p', async value => {
            const res = await POST(post(COMPLETIONS_URL, BODY, { 'content-length': value }), ctx('chat', 'completions'));
            expect([400, 413]).toContain(res.status);
            expect(upstream).not.toHaveBeenCalled();
        });

        it('answers 504 when the upstream sends no headers within the timeout', async () => {
            process.env.ASSISTANT_LLM_UPSTREAM_TIMEOUT_MS = '50';
            jest.spyOn(console, 'error').mockImplementation(() => undefined);
            upstream.mockImplementationOnce(
                (_url: string, init: RequestInit) =>
                    new Promise((_resolve, reject) => {
                        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
                    }),
            );
            const res = await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'));
            expect(res.status).toBe(504);
            expect(await res.json()).toEqual({ error: 'upstream_timeout' });
        });

        // jsdom's Response cannot wrap a web stream, so the stream guard that the relay puts on the upstream body is tested directly.
        it('cuts off a response body over the size cap and cancels the upstream', async () => {
            const chunk = new Uint8Array(MB);
            let sent = 0;
            let cancelled = false;
            const body = new ReadableStream<Uint8Array>({
                pull(controller) {
                    sent += 1;
                    controller.enqueue(chunk);
                    if (sent >= RELAY_MAX_RESPONSE_BYTES / MB + 10) controller.close();
                },
                cancel() {
                    cancelled = true;
                },
            });
            jest.spyOn(console, 'error').mockImplementation(() => undefined);
            const onDone = jest.fn();
            const { total, errored } = await drain(guardBody(body, 5000, RELAY_MAX_RESPONSE_BYTES, onDone));
            expect(total).toBeLessThanOrEqual(RELAY_MAX_RESPONSE_BYTES);
            expect(errored).toBe(true);
            expect(cancelled).toBe(true);
            expect(onDone).toHaveBeenCalledTimes(1);
        });

        it('cancels a dripping upstream body when the total deadline aborts', async () => {
            jest.spyOn(console, 'error').mockImplementation(() => undefined);
            let cancelled = false;
            const body = new ReadableStream<Uint8Array>({
                pull() {
                    return new Promise(resolve => setTimeout(resolve, 20));
                },
                cancel() {
                    cancelled = true;
                },
            });
            const deadline = new AbortController();
            setTimeout(() => deadline.abort(), 60);
            const { errored } = await drain(guardBody(body, 5000, RELAY_MAX_RESPONSE_BYTES, () => undefined, deadline.signal));
            expect(errored).toBe(true);
            expect(cancelled).toBe(true);
        });

        it('does not log an upstream failure when the client cancels during a pending read', async () => {
            const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
            const body = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => undefined) });
            const guarded = guardBody(body, 5000, RELAY_MAX_RESPONSE_BYTES, () => undefined);
            const reader = guarded.getReader();
            const pending = reader.read();
            await new Promise(resolve => setTimeout(resolve, 10));
            await reader.cancel();
            await pending.catch(() => undefined);
            await new Promise(resolve => setTimeout(resolve, 20));
            expect(errorSpy).not.toHaveBeenCalled();
        });

        it('answers 504 when the total deadline passes before headers', async () => {
            process.env.ASSISTANT_LLM_UPSTREAM_MAX_MS = '50';
            jest.spyOn(console, 'error').mockImplementation(() => undefined);
            upstream.mockImplementationOnce(
                (_url: string, init: RequestInit) =>
                    new Promise((_resolve, reject) => {
                        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
                    }),
            );
            const res = await POST(post(COMPLETIONS_URL, BODY), ctx('chat', 'completions'));
            expect(res.status).toBe(504);
        });

        it('cancels an upstream body that goes idle', async () => {
            jest.spyOn(console, 'error').mockImplementation(() => undefined);
            let cancelled = false;
            let first = true;
            const body = new ReadableStream<Uint8Array>({
                pull(controller) {
                    if (first) {
                        first = false;
                        controller.enqueue(new TextEncoder().encode('data: hi\n\n'));
                        return;
                    }
                    return new Promise(() => undefined);
                },
                cancel() {
                    cancelled = true;
                },
            });
            const { errored } = await drain(guardBody(body, 50, RELAY_MAX_RESPONSE_BYTES, () => undefined));
            expect(errored).toBe(true);
            expect(cancelled).toBe(true);
        });
    });
});
