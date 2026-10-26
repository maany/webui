import fetchMock from 'jest-fetch-mock';
import { z } from 'zod';
import type { ToolSpec } from '@/lib/core/entity/assistant/tool';
import type { RowsToolResult } from '@/lib/core/entity/assistant/data-handle';
import { DuckDbDataHandleStore } from '@/lib/infrastructure/assistant/duckdb/duckdb-data-handle-store';
import {
    baseNameFor,
    createFeatureTool,
    executeFeatureTool,
    FEATURE_TOOL_TIMEOUT_MS,
    SESSION_EXPIRED_MESSAGE,
    toQueryString,
    trimForModel,
} from '@/lib/infrastructure/assistant/feature-executor';
import { FakeDuckDbEngine } from 'test/fixtures/assistant/fake-duckdb-engine';
import { fakeResponse, ndjson } from 'test/fixtures/assistant/fake-response';

const listRules: ToolSpec<{ state?: string; account?: string; filters?: string[] }> = {
    name: 'list_rules',
    domain: 'rules',
    description: 'List rules',
    input: z.object({ state: z.string().optional(), account: z.string().optional(), filters: z.array(z.string()).optional() }),
    risk: 'read',
    requires: { flags: [] },
    executor: 'feature',
    output: 'rows',
    route: { path: '/api/feature/list-rules', method: 'GET' },
    describeCall: () => 'List rules',
};

const getRule: ToolSpec<{ id: string }> = {
    ...listRules,
    name: 'get_rule',
    input: z.object({ id: z.string() }),
    output: 'object',
    route: { path: '/api/feature/get-rule', method: 'GET' },
    describeCall: args => `Get rule ${args.id}`,
} as ToolSpec<{ id: string }>;

const listQuotas: ToolSpec<{ requestedDIDs: { scope: string; name: string }[] }> = {
    ...listRules,
    name: 'list_account_rse_quotas',
    input: z.object({ requestedDIDs: z.array(z.object({ scope: z.string(), name: z.string() })) }),
    route: { path: '/api/feature/list-account-rse-quotas', method: 'POST' },
} as ToolSpec<{ requestedDIDs: { scope: string; name: string }[] }>;

function setup() {
    const engine = new FakeDuckDbEngine();
    const handles = new DuckDbDataHandleStore(async () => engine);
    const controller = new AbortController();
    return {
        engine,
        handles,
        controller,
        deps: { signal: controller.signal, handles, rowCap: 100, now: () => new Date('2026-10-25T10:00:00.000Z') },
    };
}

const rows = (result: unknown) => result as RowsToolResult;

beforeEach(() => {
    fetchMock.resetMocks();
});

describe('request building', () => {
    it('repeats array keys and skips empty values', () => {
        expect(toQueryString({ state: 'Stuck', filters: ['a=1', 'b>2'], account: undefined, x: null })).toBe(
            'state=Stuck&filters=a%3D1&filters=b%3E2',
        );
    });

    it('derives table base names from tool names', () => {
        expect(baseNameFor('list_rules')).toBe('rules');
        expect(baseNameFor('list_did_rules')).toBe('did_rules');
        expect(baseNameFor('get_rse_usage')).toBe('rse_usage');
    });

    it('sends GET routes same-origin with redirect manual', async () => {
        const { deps } = setup();
        fetchMock.mockImplementationOnce(async () => fakeResponse({ chunks: [JSON.stringify({ status: 'success', id: 'r1' })] }));
        await executeFeatureTool(getRule, { id: 'r1' }, deps);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/feature/get-rule?id=r1');
        expect(init).toMatchObject({ method: 'GET', credentials: 'same-origin', redirect: 'manual', cache: 'no-store' });
    });

    it('sends POST routes as a JSON body', async () => {
        const { deps } = setup();
        fetchMock.mockImplementationOnce(async () =>
            fakeResponse({ contentType: 'text/event-stream', chunks: [ndjson({ status: 'success', rse: 'X' })] }),
        );
        await executeFeatureTool(listQuotas, { requestedDIDs: [{ scope: 'user', name: 'f' }] }, deps);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/feature/list-account-rse-quotas');
        expect(init).toMatchObject({ method: 'POST', body: '{"requestedDIDs":[{"scope":"user","name":"f"}]}' });
        expect((init as RequestInit).headers).toMatchObject({ 'Content-Type': 'application/json' });
    });

    it('returns invalid_args without calling fetch when the arguments do not parse', async () => {
        const { deps } = setup();
        const result = await executeFeatureTool(getRule, { id: 7 }, deps);
        expect(result).toMatchObject({ error: 'invalid_args' });
        expect((result as { message: string }).message).toContain('id');
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('session expiry (Review Focus 1)', () => {
    it('maps an opaque redirect to session_expired', async () => {
        const { deps } = setup();
        fetchMock.mockImplementationOnce(async () => fakeResponse({ status: 0, type: 'opaqueredirect', contentType: null }));
        await expect(executeFeatureTool(getRule, { id: 'r1' }, deps)).resolves.toEqual({
            error: 'session_expired',
            message: SESSION_EXPIRED_MESSAGE,
        });
    });

    it('maps a 302 to session_expired', async () => {
        const { deps } = setup();
        fetchMock.mockImplementationOnce(async () => fakeResponse({ status: 302, contentType: null }));
        await expect(executeFeatureTool(listRules, {}, deps)).resolves.toMatchObject({ error: 'session_expired' });
    });

    it('maps an HTML login page to session_expired without parsing it as JSON', async () => {
        const { deps, handles } = setup();
        fetchMock.mockImplementationOnce(async () =>
            fakeResponse({ contentType: 'text/html; charset=utf-8', chunks: ['<!DOCTYPE html><html>Login</html>'] }),
        );
        await expect(executeFeatureTool(listRules, {}, deps)).resolves.toMatchObject({ error: 'session_expired' });
        expect(handles.listHandles()).toEqual([]);
    });
});

describe('HTML on error statuses (R8)', () => {
    it('maps a 502 HTML gateway page by status and never echoes the HTML', async () => {
        const { deps } = setup();
        fetchMock.mockImplementationOnce(async () =>
            fakeResponse({ status: 502, contentType: 'text/html', chunks: ['<html>Bad gateway cookie=abc</html>'] }),
        );
        const result = (await executeFeatureTool(getRule, { id: 'r1' }, deps)) as { error: string; message: string };
        expect(result.error).toBe('unavailable');
        expect(result.message).not.toContain('<html');
        expect(result.message).not.toContain('cookie');
    });
});

describe('HTTP and presenter errors', () => {
    it.each([
        [401, 'unauthorized'],
        [403, 'forbidden'],
        [404, 'not_found'],
        [400, 'invalid_args'],
        [500, 'rucio_error'],
        [503, 'unavailable'],
    ])('maps status %s to %s and passes errorType through', async (status, code) => {
        const { deps } = setup();
        fetchMock.mockImplementationOnce(async () =>
            fakeResponse({ status, chunks: [JSON.stringify({ status: 'error', errorType: 'permission_denied', message: 'Nope' })] }),
        );
        await expect(executeFeatureTool(getRule, { id: 'r1' }, deps)).resolves.toEqual({
            error: code,
            message: 'Nope',
            errorType: 'permission_denied',
        });
    });

    it('uses the error field of route-level errors', async () => {
        const { deps } = setup();
        fetchMock.mockImplementationOnce(async () => fakeResponse({ status: 404, chunks: [JSON.stringify({ error: 'Not found' })] }));
        await expect(executeFeatureTool(getRule, { id: 'r1' }, deps)).resolves.toEqual({ error: 'not_found', message: 'Not found' });
    });

    it('passes a presenter error with status 200 through as rucio_error', async () => {
        const { deps } = setup();
        fetchMock.mockImplementationOnce(async () =>
            fakeResponse({ chunks: [JSON.stringify({ status: 'error', errorType: 'not_found', message: 'Rule not found' })] }),
        );
        await expect(executeFeatureTool(getRule, { id: 'r1' }, deps)).resolves.toEqual({
            error: 'rucio_error',
            message: 'Rule not found',
            errorType: 'not_found',
        });
    });

    it('reports a network failure as unavailable', async () => {
        const { deps } = setup();
        fetchMock.mockImplementationOnce(async () => {
            throw new TypeError('Failed to fetch');
        });
        await expect(executeFeatureTool(getRule, { id: 'r1' }, deps)).resolves.toEqual({
            error: 'unavailable',
            message: 'Request failed: Failed to fetch',
        });
    });
});

describe('object results', () => {
    it('strips the success status and scrubs secrets', async () => {
        const { deps } = setup();
        fetchMock.mockImplementationOnce(async () =>
            fakeResponse({ chunks: [JSON.stringify({ status: 'success', id: 'r1', rucioAuthToken: 'abc', nested: { password: 'x', ok: 1 } })] }),
        );
        await expect(executeFeatureTool(getRule, { id: 'r1' }, deps)).resolves.toEqual({ id: 'r1', nested: { ok: 1 } });
    });

    it('scrubs secret-like keys with the shared rule and keeps key, code and value', async () => {
        const { deps } = setup();
        fetchMock.mockImplementationOnce(async () =>
            fakeResponse({
                chunks: [
                    JSON.stringify({
                        status: 'success',
                        clientSecret: 's',
                        access_token: 't',
                        'X-Rucio-Auth-Token': 'h',
                        key: 'k',
                        code: 'c',
                        value: 'v',
                    }),
                ],
            }),
        );
        await expect(executeFeatureTool(getRule, { id: 'r1' }, deps)).resolves.toEqual({ key: 'k', code: 'c', value: 'v' });
    });

    it('trims long arrays and oversized results', () => {
        const trimmed = trimForModel({ items: Array.from({ length: 60 }, (_, i) => i) }) as { items: unknown[] };
        expect(trimmed.items).toHaveLength(51);
        expect(trimmed.items[50]).toBe('… 10 more items');
        const huge = trimForModel({ text: Array.from({ length: 40 }, () => 'x'.repeat(900)) }, 1000) as { truncated: boolean; preview: string };
        expect(huge.truncated).toBe(true);
        expect(huge.preview).toHaveLength(1000);
    });
});

describe('row results', () => {
    it('streams rows into a handle and returns a summary for the model', async () => {
        const { deps, handles } = setup();
        fetchMock.mockImplementationOnce(async () =>
            fakeResponse({
                contentType: 'text/event-stream;charset=utf-8',
                chunks: [
                    '{"status":"success","id":"a","state":"Stuck"}\n{"status":"su',
                    'ccess","id":"b","state":"OK"}\n',
                    ndjson({ status: 'success', id: 'c', state: 'OK' }, { status: 'success', id: 'd', state: 'OK' }),
                ],
            }),
        );
        const result = rows(await executeFeatureTool(listRules, { state: 'Stuck' }, deps));
        expect(result).toEqual({
            handle: 'rules_1',
            rowCount: 4,
            truncated: false,
            columns: ['id', 'state'],
            sample: [
                { id: 'a', state: 'Stuck' },
                { id: 'b', state: 'OK' },
                { id: 'c', state: 'OK' },
            ],
        });
        expect(handles.listHandles()[0].provenance).toEqual({
            toolName: 'list_rules',
            args: { state: 'Stuck' },
            fetchedAt: '2026-10-25T10:00:00.000Z',
        });
    });

    it('drops secret fields from every row before sampling and before the store sees them', async () => {
        const { deps, engine } = setup();
        fetchMock.mockImplementationOnce(async () =>
            fakeResponse({
                chunks: [
                    ndjson(
                        { id: 'a', key: 'k1', rucioAuthToken: 'abc', nested: { clientSecret: 'x', ok: 1 } },
                        { id: 'b', key: 'k2', rucioAuthToken: 'def' },
                    ),
                ],
            }),
        );
        const result = rows(await executeFeatureTool(listRules, {}, deps));
        expect(result.columns).toEqual(['id', 'key', 'nested']);
        expect(JSON.stringify(result.sample)).not.toMatch(/abc|clientSecret|rucioAuthToken/);
        expect(JSON.stringify([...engine.tables.values()])).not.toMatch(/abc|def|clientSecret|rucioAuthToken/);
        expect(result.sample[0].key).toBe('k1');
    });

    it('marks the handle truncated at the row cap', async () => {
        const { deps } = setup();
        fetchMock.mockImplementationOnce(async () => fakeResponse({ chunks: [ndjson({ i: 1 }, { i: 2 }, { i: 3 })] }));
        const result = rows(await executeFeatureTool(listRules, {}, { ...deps, rowCap: 2 }));
        expect(result).toMatchObject({ rowCount: 2, truncated: true });
        expect(result.error).toBeUndefined();
    });

    it('drops progress records and returns notices', async () => {
        const { deps } = setup();
        fetchMock.mockImplementationOnce(async () =>
            fakeResponse({
                chunks: [
                    ndjson(
                        { status: 'success', kind: 'progress', progress: { types: ['Dataset'], state: 'searching' } },
                        { status: 'success', scope: 'user', name: 'f1', did_type: 'File' },
                        { status: 'success', kind: 'notice', notice: { code: 'files-skipped', message: 'Files were skipped' } },
                    ),
                ],
            }),
        );
        const result = rows(await executeFeatureTool(listRules, {}, deps));
        expect(result).toMatchObject({ rowCount: 1, columns: ['scope', 'name', 'did_type'], notices: ['Files were skipped'] });
    });

    it('reuses an exact table name when asked', async () => {
        const { deps } = setup();
        fetchMock.mockImplementationOnce(async () => fakeResponse({ chunks: [ndjson({ i: 1 })] }));
        await expect(executeFeatureTool(listRules, {}, { ...deps, tableName: 'rules_7' })).resolves.toMatchObject({ handle: 'rules_7' });
    });

    it('returns zero rows as an empty handle', async () => {
        const { deps } = setup();
        fetchMock.mockImplementationOnce(async () => fakeResponse({ chunks: [] }));
        await expect(executeFeatureTool(listRules, {}, deps)).resolves.toMatchObject({
            handle: 'rules_1',
            rowCount: 0,
            columns: [],
            truncated: false,
        });
    });
});

describe('streams that fail half way (Review Focus 2)', () => {
    it('keeps the rows read before a trailing error object and reports truncated with an error', async () => {
        const { deps, handles } = setup();
        fetchMock.mockImplementationOnce(async () =>
            fakeResponse({
                chunks: [
                    ndjson({ status: 'success', id: 'a' }, { status: 'success', id: 'b' }),
                    JSON.stringify({ status: 'error', errorType: 'gateway_error', message: 'Rucio timed out' }),
                ],
            }),
        );
        const result = rows(await executeFeatureTool(listRules, {}, deps));
        expect(result).toMatchObject({
            handle: 'rules_1',
            rowCount: 2,
            truncated: true,
            error: { error: 'stream_error', message: 'Stream failed after 2 rows: Rucio timed out', errorType: 'gateway_error' },
        });
        expect(handles.listHandles()[0]).toMatchObject({ truncated: true, error: 'Rucio timed out' });
    });

    it('treats an error row in the middle as a failure too', async () => {
        const { deps } = setup();
        fetchMock.mockImplementationOnce(async () =>
            fakeResponse({
                chunks: [ndjson({ status: 'success', id: 'a' }, { status: 'error', message: 'DID lookup failed' }, { status: 'success', id: 'b' })],
            }),
        );
        const result = rows(await executeFeatureTool(listRules, {}, deps));
        expect(result).toMatchObject({ rowCount: 2, truncated: true, error: { error: 'stream_error' } });
    });

    it('stops at a malformed line and keeps the earlier rows', async () => {
        const { deps } = setup();
        fetchMock.mockImplementationOnce(async () => fakeResponse({ chunks: [ndjson({ id: 'a' }), '{"id": "b"\n', ndjson({ id: 'c' })] }));
        const result = rows(await executeFeatureTool(listRules, {}, deps));
        expect(result).toMatchObject({
            rowCount: 1,
            truncated: true,
            error: { error: 'stream_error', message: 'Stream failed after 1 rows: The stream sent a malformed line after 1 rows' },
        });
    });

    it('keeps the rows read before the connection dropped', async () => {
        const { deps } = setup();
        fetchMock.mockImplementationOnce(async () => fakeResponse({ chunks: [ndjson({ id: 'a' })], failWith: new TypeError('network error') }));
        const result = rows(await executeFeatureTool(listRules, {}, deps));
        expect(result).toMatchObject({
            rowCount: 1,
            truncated: true,
            error: { error: 'stream_error', message: 'Stream failed after 1 rows: Connection lost: network error' },
        });
    });

    it('returns a plain tool error and no handle when only an error object arrives', async () => {
        const { deps, handles } = setup();
        fetchMock.mockImplementationOnce(async () =>
            fakeResponse({ chunks: [JSON.stringify({ status: 'error', errorType: 'invalid_query', message: 'Invalid DID Query' })] }),
        );
        await expect(executeFeatureTool(listRules, {}, deps)).resolves.toEqual({
            error: 'rucio_error',
            message: 'Invalid DID Query',
            errorType: 'invalid_query',
        });
        expect(handles.listHandles()).toEqual([]);
    });
});

describe('timeouts and stop', () => {
    afterEach(() => jest.useRealTimers());

    it('times out after 60 seconds without an answer', async () => {
        jest.useFakeTimers();
        const { deps } = setup();
        fetchMock.mockImplementationOnce(
            (_url, init) =>
                new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
                }),
        );
        const pending = executeFeatureTool(getRule, { id: 'r1' }, deps);
        await jest.advanceTimersByTimeAsync(FEATURE_TOOL_TIMEOUT_MS);
        await expect(pending).resolves.toEqual({ error: 'timeout', message: 'No answer from /api/feature/get-rule within 60s' });
    });

    it('bounds stream reading: a stream that stops yielding times out and keeps the rows read', async () => {
        jest.useFakeTimers();
        const { deps } = setup();
        fetchMock.mockImplementationOnce(async () => fakeResponse({ chunks: [ndjson({ id: 'a' })], hang: true }));
        const pending = executeFeatureTool(listRules, {}, deps);
        await jest.advanceTimersByTimeAsync(FEATURE_TOOL_TIMEOUT_MS);
        await expect(pending).resolves.toMatchObject({
            rowCount: 1,
            truncated: true,
            error: { error: 'timeout', message: 'Stream failed after 1 rows: Timed out after 60s' },
        });
    });

    it('returns aborted when Stop is pressed while the stream hangs', async () => {
        const { deps, controller } = setup();
        fetchMock.mockImplementationOnce(async () => fakeResponse({ chunks: [ndjson({ id: 'a' })], hang: true }));
        const pending = executeFeatureTool(listRules, {}, deps);
        await new Promise(resolve => setTimeout(resolve, 10));
        controller.abort();
        await expect(pending).resolves.toEqual({ error: 'aborted', message: 'Stopped by the user' });
    });

    it('returns aborted when the user presses Stop', async () => {
        const { deps, controller } = setup();
        fetchMock.mockImplementationOnce(
            (_url, init) =>
                new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
                }),
        );
        const pending = executeFeatureTool(getRule, { id: 'r1' }, deps);
        controller.abort();
        await expect(pending).resolves.toEqual({ error: 'aborted', message: 'Stopped by the user' });
    });

    it('returns aborted without fetching when already stopped', async () => {
        const { deps, controller } = setup();
        controller.abort();
        await expect(executeFeatureTool(getRule, { id: 'r1' }, deps)).resolves.toMatchObject({ error: 'aborted' });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('createFeatureTool', () => {
    it('wraps a spec into a RegisteredTool that uses the context signal and handles', async () => {
        const { handles, controller } = setup();
        fetchMock.mockImplementationOnce(async () => fakeResponse({ chunks: [ndjson({ i: 1 })] }));
        const tool = createFeatureTool(listRules);
        expect(tool.spec).toBe(listRules);
        const ctx = { signal: controller.signal, handles } as unknown as Parameters<typeof tool.execute>[1];
        await expect(tool.execute({}, ctx)).resolves.toMatchObject({ handle: 'rules_1', rowCount: 1 });
    });
});

describe('fix round 1', () => {
    afterEach(() => jest.useRealTimers());

    it('f1: a refresh that fails with no rows keeps the previous table and handle', async () => {
        const { deps, handles, engine } = setup();
        fetchMock.mockImplementationOnce(async () => fakeResponse({ chunks: [ndjson({ id: 'old' })] }));
        await executeFeatureTool(listRules, {}, { ...deps, tableName: 'rules_7' });
        fetchMock.mockImplementationOnce(async () =>
            fakeResponse({ chunks: [JSON.stringify({ status: 'error', errorType: 'gateway_error', message: 'Rucio timed out' })] }),
        );
        const result = await executeFeatureTool(listRules, {}, { ...deps, tableName: 'rules_7' });
        expect(result).toEqual({ error: 'rucio_error', message: 'Rucio timed out', errorType: 'gateway_error' });
        expect(handles.listHandles()).toHaveLength(1);
        expect(handles.listHandles()[0]).toMatchObject({ name: 'rules_7', rowCount: 1 });
        expect(engine.tables.get('rules_7')).toHaveLength(1);
    });

    it('f1: a refresh that times out before any row keeps the previous table', async () => {
        jest.useFakeTimers();
        const { deps, handles } = setup();
        fetchMock.mockImplementationOnce(async () => fakeResponse({ chunks: [ndjson({ id: 'old' })] }));
        const first = executeFeatureTool(listRules, {}, { ...deps, tableName: 'rules_7' });
        await jest.advanceTimersByTimeAsync(0);
        await first;
        fetchMock.mockImplementationOnce(async () => fakeResponse({ chunks: [], hang: true }));
        const pending = executeFeatureTool(listRules, {}, { ...deps, tableName: 'rules_7' });
        await jest.advanceTimersByTimeAsync(FEATURE_TOOL_TIMEOUT_MS);
        await expect(pending).resolves.toMatchObject({ error: 'timeout' });
        expect(handles.listHandles()[0]).toMatchObject({ name: 'rules_7', rowCount: 1 });
    });

    it('f2: a store that never settles cannot extend the call past the timeout', async () => {
        jest.useFakeTimers();
        const { deps } = setup();
        const hung = { ...deps, handles: { ingestRows: () => new Promise(() => undefined) } as never };
        fetchMock.mockImplementationOnce(async () => fakeResponse({ chunks: [ndjson({ id: 'a' })] }));
        const pending = executeFeatureTool(listRules, {}, hung);
        await jest.advanceTimersByTimeAsync(FEATURE_TOOL_TIMEOUT_MS);
        await expect(pending).resolves.toMatchObject({ error: 'timeout' });
    });

    it('f2: Stop aborts a store that never settles', async () => {
        const { deps, controller } = setup();
        const hung = { ...deps, handles: { ingestRows: () => new Promise(() => undefined) } as never };
        fetchMock.mockImplementationOnce(async () => fakeResponse({ chunks: [ndjson({ id: 'a' })] }));
        const pending = executeFeatureTool(listRules, {}, hung);
        await new Promise(resolve => setTimeout(resolve, 10));
        controller.abort();
        await expect(pending).resolves.toEqual({ error: 'aborted', message: 'Stopped by the user' });
    });

    it('f3: a line over 1,000,000 characters stops the read and keeps earlier rows', async () => {
        const { deps } = setup();
        const huge = 'x'.repeat(600_000);
        fetchMock.mockImplementationOnce(async () => fakeResponse({ chunks: [ndjson({ id: 'a' }), huge, huge, ndjson({ id: 'late' })] }));
        const result = rows(await executeFeatureTool(listRules, {}, deps));
        expect(result).toMatchObject({ rowCount: 1, truncated: true, error: { error: 'stream_error' } });
        expect(result.error?.message).toContain('1000000');
    });

    it('f4: data rows keep fields named kind, progress and notice', async () => {
        const { deps } = setup();
        fetchMock.mockImplementationOnce(async () =>
            fakeResponse({ chunks: [ndjson({ status: 'success', kind: 'file', progress: 5, notice: 'n', id: 'a' })] }),
        );
        const result = rows(await executeFeatureTool(listRules, {}, deps));
        expect(result.sample[0]).toEqual({ kind: 'file', progress: 5, notice: 'n', id: 'a' });
    });

    it('f5: cancels the body on a session-expired answer', async () => {
        const { deps } = setup();
        const response = fakeResponse({ contentType: 'text/html', chunks: ['<html>Login</html>'] });
        const cancel = jest.spyOn(response.body as ReadableStream, 'cancel');
        fetchMock.mockImplementationOnce(async () => response);
        await executeFeatureTool(listRules, {}, deps);
        expect(cancel).toHaveBeenCalled();
    });

    it('f6: caps error-row and notice messages at 500 characters', async () => {
        const { deps } = setup();
        fetchMock.mockImplementationOnce(async () =>
            fakeResponse({
                chunks: [
                    ndjson({ id: 'a' }, { kind: 'notice', notice: { message: 'n'.repeat(900) } }, { status: 'error', message: 'e'.repeat(900) }),
                ],
            }),
        );
        const result = rows(await executeFeatureTool(listRules, {}, deps));
        expect(result.notices?.[0]).toHaveLength(500);
        expect(result.error?.message.length).toBeLessThan(600);
    });

    it('f8: handles CRLF line endings', async () => {
        const { deps } = setup();
        fetchMock.mockImplementationOnce(async () => fakeResponse({ chunks: ['{"id":"a"}\r\n{"id":"b"}\r\n'] }));
        await expect(executeFeatureTool(listRules, {}, deps)).resolves.toMatchObject({ rowCount: 2, columns: ['id'] });
    });

    it('f8: keeps ?, # and / inside one query parameter', async () => {
        const { deps } = setup();
        fetchMock.mockImplementationOnce(async () => fakeResponse({ chunks: [ndjson({ i: 1 })] }));
        await executeFeatureTool(listRules, { account: 'a?b#c/d&e' }, deps);
        expect(fetchMock.mock.calls[0][0]).toBe('/api/feature/list-rules?account=a%3Fb%23c%2Fd%26e');
    });
});

describe('fix round 2', () => {
    afterEach(() => jest.useRealTimers());

    it('g1: cancels the reader when the row cap stops the read early', async () => {
        const { deps } = setup();
        const onCancel = jest.fn();
        fetchMock.mockImplementationOnce(async () =>
            fakeResponse({ chunks: [ndjson({ i: 1 }), ndjson({ i: 2 }), ndjson({ i: 3 }), ndjson({ i: 4 })], onCancel }),
        );
        await expect(executeFeatureTool(listRules, {}, { ...deps, rowCap: 2 })).resolves.toMatchObject({ rowCount: 2, truncated: true });
        expect(onCancel).toHaveBeenCalled();
    });

    it('g1: closes the body when the store throws before reading', async () => {
        const { deps } = setup();
        const onCancel = jest.fn();
        const failing = { ...deps, handles: { ingestRows: async () => Promise.reject(new Error('boom')) } as never };
        fetchMock.mockImplementationOnce(async () => fakeResponse({ chunks: [ndjson({ i: 1 }), ndjson({ i: 2 })], onCancel }));
        await expect(executeFeatureTool(listRules, {}, failing)).resolves.toMatchObject({ error: 'unavailable' });
        expect(onCancel).toHaveBeenCalled();
    });

    it('g2: leaves no pending timers after a timed-out read resolves', async () => {
        jest.useFakeTimers();
        const { deps, handles } = setup();
        fetchMock.mockImplementationOnce(async () => fakeResponse({ chunks: [ndjson({ id: 'a' })], hang: true }));
        const pending = executeFeatureTool(listRules, {}, deps);
        await jest.advanceTimersByTimeAsync(FEATURE_TOOL_TIMEOUT_MS);
        await pending;
        await handles.terminate(); // the store's own idle timer is not ours
        expect(jest.getTimerCount()).toBe(0);
    });

    it('g3: caps errorType at 100 characters', async () => {
        const { deps } = setup();
        fetchMock.mockImplementationOnce(async () =>
            fakeResponse({ status: 500, chunks: [JSON.stringify({ errorType: 't'.repeat(300), message: 'x' })] }),
        );
        const result = (await executeFeatureTool(getRule, { id: 'r1' }, deps)) as { errorType: string };
        expect(result.errorType).toHaveLength(100);
    });

    it('g3: a complete over-long line stops the read', async () => {
        const { deps } = setup();
        fetchMock.mockImplementationOnce(async () =>
            fakeResponse({ chunks: [ndjson({ id: 'a' }), JSON.stringify({ id: 'x'.repeat(1_000_100) }) + '\n'] }),
        );
        const result = rows(await executeFeatureTool(listRules, {}, deps));
        expect(result).toMatchObject({ rowCount: 1, truncated: true, error: { error: 'stream_error' } });
        expect(result.error?.message).toContain('1000000');
    });

    it('g3: caps the message of an HTTP error', async () => {
        const { deps } = setup();
        fetchMock.mockImplementationOnce(async () => fakeResponse({ status: 500, chunks: [JSON.stringify({ message: 'm'.repeat(900) })] }));
        const result = (await executeFeatureTool(getRule, { id: 'r1' }, deps)) as { message: string };
        expect(result.message).toHaveLength(500);
    });
});
