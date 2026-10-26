import { createHmac } from 'crypto';
import { NextRequest } from 'next/server';
import fetchMock from 'jest-fetch-mock';

const signedIn = { rucioIdentity: 'jdoe', rucioAccount: 'jdoe', rucioVO: 'def', isLoggedIn: true };
const getSessionUser = jest.fn<Promise<unknown>, []>(async () => signedIn);
const getSession = jest.fn<Promise<unknown>, []>(async () => ({ user: signedIn, allUsers: [] }));

jest.mock('@/lib/infrastructure/auth/nextauth-session-utils', () => ({
    __esModule: true,
    ...jest.requireActual('@/lib/infrastructure/auth/nextauth-session-utils'),
    getSessionUser: () => getSessionUser(),
    getSession: () => getSession(),
}));

import { POST } from '@/app/api/assistant/telemetry/route';
import AssistantConfigGateway from '@/lib/infrastructure/gateway/assistant-config-gateway';
import { relayTelemetry, telemetryRelayRateLimiter } from '@/lib/infrastructure/assistant/telemetry-relay';

const UPSTREAM = 'https://langfuse.internal.example.org/api/public/otel/v1/traces';
const BODY = JSON.stringify({ resourceSpans: [] });
const SALT = 'a-long-operator-salt-0123';

const req = (body: string | Uint8Array = BODY, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
    new NextRequest('http://localhost/api/assistant/telemetry', {
        method: 'POST',
        headers: { cookie: 'authjs.session-token=browser-cookie', authorization: 'Bearer browser-token', ...headers },
        body,
    });

/** OTLP/HTTP JSON with the account in resource, span and span event attributes. */
const otlpBody = (userId: string) => ({
    resourceSpans: [
        {
            resource: { attributes: [{ key: 'user.id', value: { stringValue: userId } }] },
            scopeSpans: [
                {
                    spans: [
                        {
                            name: 'invoke_agent Rucio bot',
                            attributes: [
                                { key: 'user.id', value: { stringValue: userId } },
                                { key: 'langfuse.user.id', value: { stringValue: userId } },
                            ],
                            events: [
                                { name: 'tool.approval', attributes: [{ key: 'rucio.assistant.approval.approver', value: { stringValue: userId } }] },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
});

const directRequest = (bytes: Uint8Array, signal?: AbortSignal) => {
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(bytes);
            controller.close();
        },
    });
    return { headers: new Headers({ 'content-type': 'application/json' }), body: stream, signal } as unknown as Request;
};

const directDeps = (fetchImpl: unknown) => ({
    assistantEnabled: async () => true,
    session: async () => ({ rateLimitKey: 'k', accountKey: 'jdoe@def', accountKeys: ['jdoe@def'] }),
    upstream: async () => ({ endpoint: UPSTREAM, headers: { Authorization: 'Basic x' }, rateLimitPerMinute: 30, hashUser: false }),
    rateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    fetchImpl: fetchImpl as typeof fetch,
});

let account = 0;
let saltSpy: jest.SpyInstance | undefined;

/** Mocks phase 1a's getTelemetryUserSalt (the only source of the salt). */
const mockSalt = (salt: string | undefined) => {
    saltSpy = jest.spyOn(AssistantConfigGateway.prototype, 'getTelemetryUserSalt').mockResolvedValue(salt);
};

describe('POST /api/assistant/telemetry', () => {
    beforeEach(() => {
        fetchMock.resetMocks();
        telemetryRelayRateLimiter.reset();
        process.env.FEATURE_ASSISTANT = 'true';
        process.env.ASSISTANT_TELEMETRY_OTLP_ENDPOINT = UPSTREAM;
        process.env.ASSISTANT_TELEMETRY_OTLP_HEADERS = 'Authorization=Basic cGs6c2s=,x-langfuse-ingestion-version=4';
        // A fresh account per test keeps the in-memory rate limit window separate.
        account += 1;
        getSessionUser.mockResolvedValue({ ...signedIn, rucioAccount: `jdoe${account}` });
        getSession.mockResolvedValue({ user: { ...signedIn, rucioAccount: `jdoe${account}` }, allUsers: [] });
    });

    afterEach(() => {
        delete process.env.FEATURE_ASSISTANT;
        delete process.env.ASSISTANT_TELEMETRY_OTLP_ENDPOINT;
        delete process.env.ASSISTANT_TELEMETRY_OTLP_HEADERS;
        delete process.env.ASSISTANT_TELEMETRY_HASH_USER;
        delete process.env.ASSISTANT_RELAY_RATE_LIMIT;
        saltSpy?.mockRestore();
        saltSpy = undefined;
    });

    it('returns 404 when the assistant flag is off', async () => {
        process.env.FEATURE_ASSISTANT = 'false';
        const res = await POST(req());
        expect(res.status).toBe(404);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns 401 without a session', async () => {
        getSessionUser.mockResolvedValue(undefined);
        expect((await POST(req())).status).toBe(401);
        getSessionUser.mockResolvedValue({ ...signedIn, isLoggedIn: false });
        expect((await POST(req())).status).toBe(401);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns 404 when no valid operator endpoint is configured', async () => {
        delete process.env.ASSISTANT_TELEMETRY_OTLP_ENDPOINT;
        expect((await POST(req())).status).toBe(404);
        process.env.ASSISTANT_TELEMETRY_OTLP_ENDPOINT = 'ftp://langfuse.internal.example.org/v1/traces';
        expect((await POST(req())).status).toBe(404);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns 404 when hashUser is on without a valid salt', async () => {
        process.env.ASSISTANT_TELEMETRY_HASH_USER = 'true';
        mockSalt(undefined);
        expect((await POST(req())).status).toBe(404);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(['text/plain', 'application/x-protobuf'])('rejects other content types: %s', async contentType => {
        const res = await POST(req(BODY, { 'content-type': contentType }));
        expect(res.status).toBe(415);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    // jsdom's NextRequest has no web stream body, so this exercises the arrayBuffer fallback; the streaming cap is covered by the direct relayTelemetry test below.
    it('rejects bodies over 1 MiB', async () => {
        const res = await POST(req(new Uint8Array(1048577)));
        expect(res.status).toBe(413);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('stops reading an over-cap body that has no content-length and does not call the upstream', async () => {
        // jsdom's Request polyfill buffers bodies, so a real chunked stream is fed to relayTelemetry directly.
        const chunk = new Uint8Array(512 * 1024);
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
        const request = { headers: new Headers({ 'content-type': 'application/json' }), body: stream } as unknown as Request;
        const fetchImpl = jest.fn();
        const res = await relayTelemetry(request, {
            assistantEnabled: async () => true,
            session: async () => ({ rateLimitKey: 'k', accountKey: 'jdoe@def', accountKeys: ['jdoe@def'] }),
            upstream: async () => ({ endpoint: UPSTREAM, headers: {}, rateLimitPerMinute: 30, hashUser: false }),
            rateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });
        expect(res.status).toBe(413);
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(cancelled).toBe(true);
        expect(sent).toBeLessThan(100);
    });

    it('forwards JSON unchanged to the env endpoint with env headers only when hashUser is off', async () => {
        fetchMock.mockResponseOnce('{"partialSuccess":{}}', { status: 200 });
        const res = await POST(req());
        expect(res.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(UPSTREAM);
        expect(init.method).toBe('POST');
        const sent = new Headers(init.headers as HeadersInit);
        expect(Array.from(sent.keys()).sort()).toEqual(['authorization', 'content-type', 'x-langfuse-ingestion-version']);
        expect(sent.get('authorization')).toBe('Basic cGs6c2s=');
        expect(sent.get('x-langfuse-ingestion-version')).toBe('4');
        expect(sent.get('content-type')).toBe('application/json');
        expect(sent.has('cookie')).toBe(false);
        expect(init.redirect).toBe('error');
        expect(Buffer.from(init.body as ArrayBuffer).toString()).toBe(BODY);
    });

    it('replaces the account with its salted HMAC in resource and span attributes when hashUser is on', async () => {
        process.env.ASSISTANT_TELEMETRY_HASH_USER = 'true';
        mockSalt(SALT);
        fetchMock.mockResponseOnce('{}', { status: 200 });
        const accountKey = `jdoe${account}@def`;
        const res = await POST(req(JSON.stringify(otlpBody(accountKey))));
        expect(res.status).toBe(200);
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const forwarded = String(init.body);
        const hashed = createHmac('sha256', SALT).update(accountKey).digest('hex');
        expect(forwarded).not.toContain(accountKey);
        const parsed = JSON.parse(forwarded);
        expect(parsed.resourceSpans[0].resource.attributes).toEqual([{ key: 'user.id', value: { stringValue: hashed } }]);
        const span = parsed.resourceSpans[0].scopeSpans[0].spans[0];
        expect(span.attributes).toEqual([
            { key: 'user.id', value: { stringValue: hashed } },
            { key: 'langfuse.user.id', value: { stringValue: hashed } },
        ]);
        expect(span.events[0].attributes).toEqual([{ key: 'rucio.assistant.approval.approver', value: { stringValue: hashed } }]);
    });

    it('answers 400 when hashing and the body is not JSON', async () => {
        process.env.ASSISTANT_TELEMETRY_HASH_USER = 'true';
        mockSalt(SALT);
        const res = await POST(req('not json'));
        expect(res.status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rate limits per session with ASSISTANT_RELAY_RATE_LIMIT', async () => {
        process.env.ASSISTANT_RELAY_RATE_LIMIT = '2';
        fetchMock.mockResponse('{}', { status: 200 });
        expect((await POST(req())).status).toBe(200);
        expect((await POST(req())).status).toBe(200);
        const limited = await POST(req());
        expect(limited.status).toBe(429);
        expect(limited.headers.get('retry-after')).toBe('60');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each([
        [503, 503],
        [502, 503],
        [429, 429],
        [401, 500],
    ])('maps upstream %s to %s', async (upstream, expected) => {
        fetchMock.mockResponseOnce('{"message":"upstream body"}', { status: upstream });
        expect((await POST(req())).status).toBe(expected);
    });

    it('answers 504 when the upstream is unreachable and does not log the body', async () => {
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        fetchMock.mockRejectOnce(new TypeError('connect ECONNREFUSED'));
        const res = await POST(req(JSON.stringify({ secret: 'span-content-should-not-be-logged' })));
        expect(res.status).toBe(504);
        expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('span-content-should-not-be-logged');
        errorSpy.mockRestore();
    });

    it('passes a numeric upstream retry-after on 429 and replaces anything else with 10', async () => {
        fetchMock.mockResponseOnce('{}', { status: 429, headers: { 'retry-after': '42' } });
        const ok = await POST(req());
        expect(ok.status).toBe(429);
        expect(ok.headers.get('retry-after')).toBe('42');
        fetchMock.mockResponseOnce('{}', { status: 429, headers: { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' } });
        expect((await POST(req())).headers.get('retry-after')).toBe('10');
        fetchMock.mockResponseOnce('{}', { status: 429 });
        expect((await POST(req())).headers.get('retry-after')).toBe('10');
    });

    it('does not echo upstream set-cookie or www-authenticate headers', async () => {
        fetchMock.mockResponseOnce('{"secret":"upstream"}', {
            status: 401,
            headers: { 'set-cookie': 'sid=abc', 'www-authenticate': 'Basic realm="x"' },
        });
        const res = await POST(req());
        expect(res.headers.get('set-cookie')).toBeNull();
        expect(res.headers.get('www-authenticate')).toBeNull();
        expect(await res.text()).not.toContain('upstream"');
    });

    it.each([200, 429, 503])('cancels the upstream body for status %s', async status => {
        const cancel = jest.fn(async () => undefined);
        const fetchImpl = jest.fn(async () => ({ ok: status < 300, status, headers: new Headers(), body: { cancel } } as unknown as Response));
        const res = await relayTelemetry(directRequest(new TextEncoder().encode(BODY)), directDeps(fetchImpl));
        expect(res.status).toBe(status);
        expect(cancel).toHaveBeenCalledTimes(1);
    });

    it('hashes each session account with its own hash and maps a foreign id to the active hash', async () => {
        process.env.ASSISTANT_TELEMETRY_HASH_USER = 'true';
        mockSalt(SALT);
        const active = `jdoe${account}@def`;
        const inactive = 'asmith@def';
        getSession.mockResolvedValue({
            user: { ...signedIn, rucioAccount: `jdoe${account}` },
            allUsers: [
                { ...signedIn, rucioAccount: `jdoe${account}` },
                { ...signedIn, rucioAccount: 'asmith' },
            ],
        });
        fetchMock.mockResponse('{}', { status: 200 });
        const hash = (key: string) => createHmac('sha256', SALT).update(key).digest('hex');
        await POST(req(JSON.stringify(otlpBody(inactive))));
        let forwarded = String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body);
        expect(forwarded).not.toContain(inactive);
        expect(forwarded).not.toContain(active);
        expect(JSON.parse(forwarded).resourceSpans[0].scopeSpans[0].spans[0].attributes[0].value.stringValue).toBe(hash(inactive));
        await POST(req(JSON.stringify(otlpBody('mallory@def'))));
        forwarded = String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body);
        expect(forwarded).not.toContain('mallory');
        expect(JSON.parse(forwarded).resourceSpans[0].scopeSpans[0].spans[0].attributes[0].value.stringValue).toBe(hash(active));
    });

    it('answers 400, never 500, for a deeply nested body when hashing', async () => {
        process.env.ASSISTANT_TELEMETRY_HASH_USER = 'true';
        mockSalt(SALT);
        fetchMock.mockResponse('{}', { status: 200 });
        const deep = '{"a":'.repeat(100000) + '1' + '}'.repeat(100000);
        const res = await POST(req(deep));
        expect(res.status).toBe(400);
        const nested = '{"arrayValue":{"values":['.repeat(5000) + '{"stringValue":"x"}' + ']}}'.repeat(5000);
        const res2 = await POST(req(`{"resourceSpans":[{"scopeSpans":[{"spans":[{"attributes":[{"key":"k","value":${nested}}]}]}]}]}`));
        expect([200, 400]).toContain(res2.status);
    });

    it('answers 400 when the client aborts mid-body', async () => {
        const stream = new ReadableStream<Uint8Array>({
            pull() {
                throw new Error('aborted');
            },
        });
        const request = { headers: new Headers({ 'content-type': 'application/json' }), body: stream } as unknown as Request;
        const fetchImpl = jest.fn();
        const res = await relayTelemetry(request, directDeps(fetchImpl));
        expect(res.status).toBe(400);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('aborts the upstream fetch when the client request is aborted', async () => {
        const clientAbort = new AbortController();
        let upstreamSignal: AbortSignal | undefined;
        const fetchImpl = jest.fn(async (_url: unknown, init?: RequestInit) => {
            upstreamSignal = init?.signal as AbortSignal;
            return { ok: true, status: 200, headers: new Headers(), body: null } as unknown as Response;
        });
        const request = directRequest(new TextEncoder().encode(BODY), clientAbort.signal);
        await relayTelemetry(request, directDeps(fetchImpl));
        expect(upstreamSignal).toBeDefined();
        clientAbort.abort();
        expect(upstreamSignal?.aborted).toBe(true);
    });
});
