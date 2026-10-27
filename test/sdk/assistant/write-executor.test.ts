import { SESSION_EXPIRED_MESSAGE } from '@/lib/infrastructure/assistant/feature-executor';
import { executeWriteRequest, interpretWriteResponse, type FetchLike, type FetchResponseLike } from '@/lib/infrastructure/assistant/write-executor';

type ResponseInit = Partial<Omit<FetchResponseLike, 'headers' | 'text'>> & { body?: string; contentType?: string | null };

function response({ body = '', contentType = 'application/json', status = 200, ...rest }: ResponseInit = {}): FetchResponseLike {
    return {
        ok: status >= 200 && status < 300,
        status,
        type: 'basic',
        redirected: false,
        url: 'http://localhost/api/feature/create-rule',
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
        text: async () => body,
        ...rest,
    };
}

const json = (status: number, value: unknown) => response({ status, body: JSON.stringify(value) });
const SESSION_EXPIRED = { error: 'session_expired', message: SESSION_EXPIRED_MESSAGE };
const route = { path: '/api/feature/create-rule', method: 'POST' as const };

describe('interpretWriteResponse', () => {
    it('treats an opaque redirect (proxy 302 with redirect: manual) as session_expired', async () => {
        await expect(interpretWriteResponse(response({ type: 'opaqueredirect', status: 0, contentType: null }))).resolves.toEqual(SESSION_EXPIRED);
    });

    it('treats a followed redirect to the login page as session_expired', async () => {
        const res = response({
            redirected: true,
            url: 'http://localhost/auth/login?callbackUrl=/x',
            contentType: 'text/html',
            body: '<html></html>',
        });
        await expect(interpretWriteResponse(res)).resolves.toEqual(SESSION_EXPIRED);
    });

    it('treats an HTML page without a redirect flag as session_expired and does not throw', async () => {
        await expect(interpretWriteResponse(response({ contentType: 'text/html; charset=utf-8', body: '<!doctype html>' }))).resolves.toEqual(
            SESSION_EXPIRED,
        );
    });

    it('maps 403 with a presenter errorType to forbidden and keeps the errorType', async () => {
        const res = json(403, { status: 'error', errorType: 'permission_denied', message: 'Administrator role required' });
        await expect(interpretWriteResponse(res)).resolves.toEqual({
            error: 'forbidden',
            message: 'Administrator role required',
            errorType: 'permission_denied',
        });
    });

    it('maps a legacy 400 body to invalid_args with its error text', async () => {
        const res = json(400, { error: 'Missing required parameters or provided parameters are invalid', details: [] });
        await expect(interpretWriteResponse(res)).resolves.toEqual({
            error: 'invalid_args',
            message: 'Missing required parameters or provided parameters are invalid',
        });
    });

    it('maps a withFeature 404 to not_found', async () => {
        await expect(interpretWriteResponse(json(404, { error: 'Not found' }))).resolves.toEqual({ error: 'not_found', message: 'Not found' });
    });

    it('maps a 200 view model with status error to rucio_error', async () => {
        const res = json(200, { status: 'error', message: 'Duplicate rule', errorType: 'conflict' });
        await expect(interpretWriteResponse(res)).resolves.toEqual({ error: 'rucio_error', message: 'Duplicate rule', errorType: 'conflict' });
    });

    it('maps invalid JSON to rucio_error instead of throwing', async () => {
        await expect(interpretWriteResponse(response({ body: '{not json' }))).resolves.toMatchObject({ error: 'rucio_error' });
    });

    it('returns the view model on success', async () => {
        await expect(interpretWriteResponse(json(200, { status: 'success', rule_ids: ['r1'] }))).resolves.toEqual({
            status: 'success',
            rule_ids: ['r1'],
        });
    });
    it('removes credential-named fields from a success view model', async () => {
        const res = json(200, { status: 'success', account: 'jdoe', rucioAuthToken: 'tok', nested: { password: 'pw', keep: 1 } });
        const result = await interpretWriteResponse(res);
        expect(result).toEqual({ status: 'success', account: 'jdoe', nested: { keep: 1 } });
        expect(JSON.stringify(result)).not.toContain('tok');
    });

    it('caps a long server error message to 500 characters', async () => {
        const res = json(200, { status: 'error', message: 'x'.repeat(2000) });
        const result = (await interpretWriteResponse(res)) as { message: string };
        expect(result.message).toHaveLength(500);
        const legacy = (await interpretWriteResponse(json(400, { error: 'y'.repeat(2000) }))) as { message: string };
        expect(legacy.message).toHaveLength(500);
    });
    it.each([502, 503, 504])('maps %i with an HTML body to unavailable and warns the change may have landed', async status => {
        const result = (await interpretWriteResponse(response({ status, contentType: 'text/html', body: '<html>Bad gateway</html>' }))) as {
            error: string;
            message: string;
        };
        expect(result.error).toBe('unavailable');
        expect(result.message).toContain('may still have been applied');
    });

    it.each([502, 503, 504])('maps %i with a JSON body to unavailable and warns the change may have landed', async status => {
        const result = (await interpretWriteResponse(json(status, { error: 'upstream down' }))) as { error: string; message: string };
        expect(result.error).toBe('unavailable');
        expect(result.message).toContain('upstream down');
        expect(result.message).toContain('may still have been applied');
    });

    it('does not warn about a landed change on a 400', async () => {
        const result = (await interpretWriteResponse(json(400, { error: 'bad' }))) as { message: string };
        expect(result.message).not.toContain('may still have been applied');
    });

    it('says a 2xx with invalid JSON or non-JSON was probably applied', async () => {
        const bad = (await interpretWriteResponse(response({ body: '{not json' }))) as { error: string; message: string };
        expect(bad.error).toBe('rucio_error');
        expect(bad.message).toContain('probably applied');
        const plain = (await interpretWriteResponse(response({ contentType: 'text/plain', body: 'ok' }))) as { error: string; message: string };
        expect(plain.error).toBe('rucio_error');
        expect(plain.message).toContain('probably applied');
    });

    it('trims a large success body', async () => {
        const result = (await interpretWriteResponse(
            json(200, { status: 'success', items: Array.from({ length: 500 }, (_, i) => `item-${i}-${'x'.repeat(40)}`) }),
        )) as {
            items: unknown[];
        };
        expect(JSON.stringify(result).length).toBeLessThan(9000);
    });

    it('returns a fresh session expired object each time', async () => {
        const a = await interpretWriteResponse(response({ type: 'opaqueredirect', status: 0, contentType: null }));
        const b = await interpretWriteResponse(response({ type: 'opaqueredirect', status: 0, contentType: null }));
        expect(a).not.toBe(b);
    });
});

describe('executeWriteRequest', () => {
    it('sends one same-origin JSON request with the route method and no redirect following', async () => {
        const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(async () => json(200, { status: 'success' }));
        const result = await executeWriteRequest(route, { copies: 1 }, new AbortController().signal, { fetchImpl });
        expect(result).toEqual({ status: 'success' });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe('/api/feature/create-rule');
        expect(init).toMatchObject({ method: 'POST', body: '{"copies":1}', credentials: 'same-origin', redirect: 'manual' });
        expect(init.headers).toEqual({ 'Content-Type': 'application/json', Accept: 'application/json' });
    });

    it('returns timeout and warns that the change may have landed', async () => {
        const hanging: FetchLike = (_input, init) =>
            new Promise((_resolve, reject) => {
                init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            });
        const result = await executeWriteRequest(route, {}, new AbortController().signal, { fetchImpl: hanging, timeoutMs: 20 });
        expect(result).toMatchObject({ error: 'timeout' });
        expect((result as { message: string }).message).toContain('may still have been applied');
    });

    it('returns aborted when the user stops the turn', async () => {
        const controller = new AbortController();
        const hanging: FetchLike = (_input, init) =>
            new Promise((_resolve, reject) => {
                init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            });
        const pending = executeWriteRequest(route, {}, controller.signal, { fetchImpl: hanging });
        controller.abort();
        await expect(pending).resolves.toMatchObject({ error: 'aborted' });
    });

    it('does not send anything when the signal is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>();
        await expect(executeWriteRequest(route, {}, controller.signal, { fetchImpl })).resolves.toMatchObject({ error: 'aborted' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('maps a network failure to unavailable', async () => {
        const failing: FetchLike = async () => {
            throw new TypeError('Failed to fetch');
        };
        await expect(executeWriteRequest(route, {}, new AbortController().signal, { fetchImpl: failing })).resolves.toMatchObject({
            error: 'unavailable',
        });
    });
    it('returns timeout with the warning when the body read rejects after the timeout', async () => {
        const slowBody: FetchLike = async (_input, init) => ({
            ...response({ body: '{}' }),
            text: () =>
                new Promise<string>((_resolve, reject) => {
                    init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
                }),
        });
        const result = await executeWriteRequest(route, {}, new AbortController().signal, { fetchImpl: slowBody, timeoutMs: 20 });
        expect(result).toMatchObject({ error: 'timeout' });
        expect((result as { message: string }).message).toContain('may still have been applied');
    });

    it('returns aborted with the warning when the body read rejects after the user stops', async () => {
        const controller = new AbortController();
        const slowBody: FetchLike = async (_input, init) => ({
            ...response({ body: '{}' }),
            text: () =>
                new Promise<string>((_resolve, reject) => {
                    init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
                    controller.abort();
                }),
        });
        const result = await executeWriteRequest(route, {}, controller.signal, { fetchImpl: slowBody });
        expect(result).toMatchObject({ error: 'aborted' });
        expect((result as { message: string }).message).toContain('may still have been applied');
    });

    it('says a network failure may have landed too', async () => {
        const failing: FetchLike = async () => {
            throw new TypeError('Failed to fetch');
        };
        const result = (await executeWriteRequest(route, {}, new AbortController().signal, { fetchImpl: failing })) as { message: string };
        expect(result.message).toContain('may still have been applied');
    });
});

describe('executeWriteRequest account binding', () => {
    it('sends the expected account header when given', async () => {
        const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(async () => json(200, { status: 'success' }));
        await executeWriteRequest(route, {}, new AbortController().signal, { fetchImpl, expectedAccount: 'jdoe@def' });
        expect(fetchImpl.mock.calls[0][1].headers).toEqual({
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'x-rucio-assistant-account': 'jdoe@def',
        });
    });

    it('maps a 409 account_mismatch to a denied ToolError that says nothing changed and does not claim it may have landed', async () => {
        const message = 'The signed-in account changed after this action was approved. Nothing changed.';
        const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(async () =>
            json(409, { status: 'error', errorType: 'account_mismatch', message }),
        );
        const result = (await executeWriteRequest(route, {}, new AbortController().signal, { fetchImpl, expectedAccount: 'jdoe@def' })) as {
            error: string;
            message: string;
            errorType?: string;
        };
        expect(result.error).toBe('denied_by_policy');
        expect(result.errorType).toBe('account_mismatch');
        expect(result.message).toContain('Nothing changed');
        expect(result.message).not.toContain('may still have been applied');
    });
});
