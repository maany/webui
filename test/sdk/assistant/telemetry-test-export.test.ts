import { buildTestSpanPayload, testTelemetryExport } from '@/lib/infrastructure/assistant/telemetry-test-export';

const target = { url: 'https://cloud.langfuse.com/api/public/otel/v1/traces', headers: { Authorization: 'Basic abc' } };

function fetchReturning(status: number) {
    return jest.fn(async () => ({ ok: status >= 200 && status < 300, status } as Response));
}

describe('buildTestSpanPayload', () => {
    it('serializes one test span as OTLP JSON', async () => {
        const payload = JSON.parse(new TextDecoder().decode(await buildTestSpanPayload()));
        const spans = payload.resourceSpans[0].scopeSpans[0].spans;
        expect(spans).toHaveLength(1);
        expect(spans[0].name).toBe('Rucio bot test');
    });
});

describe('testTelemetryExport', () => {
    it('posts JSON with the sink headers and no cookies', async () => {
        const fetchImpl = fetchReturning(200);
        await expect(testTelemetryExport(target, { fetchImpl, pageProtocol: 'https:' })).resolves.toEqual({ ok: true, status: 200 });
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe(target.url);
        expect(init).toMatchObject({
            method: 'POST',
            mode: 'cors',
            credentials: 'omit',
            headers: { Authorization: 'Basic abc', 'Content-Type': 'application/json' },
        });
    });

    it.each([
        [401, 'unauthorized'],
        [403, 'unauthorized'],
        [404, 'not-found'],
        [500, 'http-error'],
    ])('maps HTTP %s to %s', async (status, reason) => {
        await expect(testTelemetryExport(target, { fetchImpl: fetchReturning(status), pageProtocol: 'https:' })).resolves.toEqual({
            ok: false,
            reason,
            status,
        });
    });

    it('maps a fetch TypeError (CORS or unreachable) to network', async () => {
        const fetchImpl = jest.fn(async () => {
            throw new TypeError('Failed to fetch');
        });
        await expect(testTelemetryExport(target, { fetchImpl, pageProtocol: 'https:' })).resolves.toEqual({ ok: false, reason: 'network' });
    });

    it('maps an abort after the timeout to timeout', async () => {
        const fetchImpl = jest.fn(
            (_url: string, init: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
                }),
        );
        await expect(
            testTelemetryExport(target, { fetchImpl: fetchImpl as unknown as typeof fetch, pageProtocol: 'https:', timeoutMs: 10 }),
        ).resolves.toEqual({
            ok: false,
            reason: 'timeout',
        });
    });

    it('rejects invalid URLs and mixed content before sending', async () => {
        const fetchImpl = fetchReturning(200);
        await expect(testTelemetryExport({ url: 'not a url', headers: {} }, { fetchImpl })).resolves.toEqual({ ok: false, reason: 'invalid-url' });
        await expect(testTelemetryExport({ url: 'ftp://x.org/v1/traces', headers: {} }, { fetchImpl })).resolves.toEqual({
            ok: false,
            reason: 'invalid-url',
        });
        await expect(
            testTelemetryExport({ url: 'http://otel.example.org/v1/traces', headers: {} }, { fetchImpl, pageProtocol: 'https:' }),
        ).resolves.toEqual({
            ok: false,
            reason: 'mixed-content',
        });
        expect(fetchImpl).not.toHaveBeenCalled();
        await expect(
            testTelemetryExport({ url: 'http://localhost:4318/v1/traces', headers: {} }, { fetchImpl, pageProtocol: 'https:' }),
        ).resolves.toEqual({
            ok: true,
            status: 200,
        });
    });

    it('does not follow redirects', async () => {
        const fetchImpl = fetchReturning(200);
        await testTelemetryExport(target, { fetchImpl, pageProtocol: 'https:' });
        const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(init.redirect).toBe('error');
    });

    it('replaces any case variant of content-type', async () => {
        const fetchImpl = fetchReturning(200);
        await testTelemetryExport(
            { ...target, headers: { ...target.headers, 'content-type': 'text/plain', 'CONTENT-TYPE': 'x/y' } },
            { fetchImpl, pageProtocol: 'https:' },
        );
        const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(init.headers).toEqual({ Authorization: 'Basic abc', 'Content-Type': 'application/json' });
    });

    it('never rejects when fetch is unavailable', async () => {
        const original = globalThis.fetch;
        // @ts-expect-error simulate a runtime without fetch
        globalThis.fetch = undefined;
        try {
            await expect(testTelemetryExport(target, { pageProtocol: 'https:' })).resolves.toEqual({ ok: false, reason: 'network' });
        } finally {
            globalThis.fetch = original;
        }
    });
});
