import type { ToolError, ToolErrorCode, ToolSpec } from '@/lib/core/entity/assistant/tool';
import type { DataHandle, RowsToolResult } from '@/lib/core/entity/assistant/data-handle';
import type { AssistantDataHandleStorePort } from '@/lib/core/port/secondary/assistant-data-handle-store-port';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import { abortError, errorMessage, isAbortError } from '@/lib/infrastructure/assistant/abort';
import { DataHandleStoreError } from '@/lib/infrastructure/assistant/duckdb/duckdb-data-handle-store';
import { defaultRowCap } from '@/lib/infrastructure/assistant/row-cap';
import { isSecretFieldName } from '@/lib/core/services/assistant-secret-keys';
import { ACCOUNT_CHANGED_READ_MESSAGE, ACCOUNT_MISMATCH_ERROR_TYPE, ASSISTANT_ACCOUNT_HEADER } from '@/lib/infrastructure/assistant/account-binding';
import { toolError } from '@/lib/infrastructure/assistant/tool-error';

export const FEATURE_TOOL_TIMEOUT_MS = 60_000;
export const MAX_OBJECT_RESULT_CHARS = 8_000;
export const SAMPLE_SIZE = 3;
export const SESSION_EXPIRED_MESSAGE = 'Your WebUI session has expired. Ask the user to log in again, then retry.';

const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_CHARS = 1_000;
const MAX_SAMPLE_STRING_CHARS = 200;
const MAX_DEPTH = 6;
const MAX_LINE_CHARS = 1_000_000;
const MAX_MESSAGE_CHARS = 500;
const MAX_ERROR_TYPE_CHARS = 100;
/** After a read timeout the store may still finish writing the rows already read, for at most this long. */
const ENGINE_GRACE_MS = 5_000;

export interface FeatureExecutionDeps {
    signal: AbortSignal;
    handles: AssistantDataHandleStorePort;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    rowCap?: number;
    /** Exact handle name to (re)create; refresh uses it to keep the name the model already knows. */
    tableName?: string;
    now?: () => Date;
    /** `account@vo` the request runs as; the server refuses it when the session account differs. */
    expectedAccount?: string;
}

type JsonRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is JsonRecord => typeof value === 'object' && value !== null && !Array.isArray(value);

/** "list_did_rules" -> "did_rules", "list_rules" -> "rules". */
export function baseNameFor(toolName: string): string {
    return toolName.replace(/^(list|get)_/, '');
}

/** Query string for GET routes. Arrays become repeated keys, undefined and null are skipped. */
export function toQueryString(args: unknown): string {
    if (!isRecord(args)) return '';
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(args)) {
        const values = Array.isArray(value) ? value : [value];
        for (const item of values) {
            if (item === undefined || item === null) continue;
            params.append(key, item instanceof Date ? item.toISOString() : typeof item === 'object' ? JSON.stringify(item) : String(item));
        }
    }
    return params.toString();
}

/** GET sends query parameters; POST, PUT and DELETE send a JSON body (the WebUI routes read DELETE bodies too). */
export function buildFeatureRequest(route: { path: string; method: string }, args: unknown): { url: string; init: RequestInit } {
    if (route.method === 'GET') {
        const query = toQueryString(args);
        return { url: query ? `${route.path}?${query}` : route.path, init: { method: 'GET' } };
    }
    return {
        url: route.path,
        init: { method: route.method, body: JSON.stringify(args ?? {}), headers: { 'Content-Type': 'application/json' } },
    };
}

/** src/proxy.ts answers an expired session with a redirect to the login page, never with 401. */
export function isLoginRedirect(response: Response): boolean {
    if (response.type === 'opaqueredirect' || response.redirected) return true;
    if (response.status === 0 || (response.status >= 300 && response.status < 400)) return true;
    // An HTML body on a 2xx is the login page; on an error status it is a gateway page and maps by status.
    return response.ok && (response.headers.get('content-type') ?? '').toLowerCase().includes('text/html');
}

export function errorCodeForStatus(status: number): ToolErrorCode {
    if (status === 400 || status === 422) return 'invalid_args';
    if (status === 401) return 'unauthorized';
    if (status === 403) return 'forbidden';
    if (status === 404) return 'not_found';
    if (status === 502 || status === 503 || status === 504) return 'unavailable';
    return 'rucio_error';
}

function messageFrom(body: unknown): string | undefined {
    if (!isRecord(body)) return undefined;
    if (typeof body.message === 'string' && body.message !== '') return body.message.slice(0, MAX_MESSAGE_CHARS);
    if (typeof body.error === 'string' && body.error !== '') return body.error.slice(0, MAX_MESSAGE_CHARS);
    return undefined;
}

function errorTypeFrom(body: unknown): string | undefined {
    return isRecord(body) && typeof body.errorType === 'string' ? body.errorType.slice(0, MAX_ERROR_TYPE_CHARS) : undefined;
}

async function readJsonSafely(response: Response): Promise<unknown> {
    try {
        const text = await response.text();
        return text ? JSON.parse(text) : undefined;
    } catch {
        return undefined;
    }
}

export function scrubSecrets(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(scrubSecrets);
    if (isRecord(value)) {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([key]) => !isSecretFieldName(key))
                .map(([key, inner]) => [key, scrubSecrets(inner)]),
        );
    }
    return value;
}

function trimValue(value: unknown, depth: number): unknown {
    if (typeof value === 'string') return value.length > MAX_STRING_CHARS ? `${value.slice(0, MAX_STRING_CHARS)}…` : value;
    if (Array.isArray(value)) {
        if (depth >= MAX_DEPTH) return `[${value.length} items]`;
        const items: unknown[] = value.slice(0, MAX_ARRAY_ITEMS).map(item => trimValue(item, depth + 1));
        if (value.length > MAX_ARRAY_ITEMS) items.push(`… ${value.length - MAX_ARRAY_ITEMS} more items`);
        return items;
    }
    if (isRecord(value)) {
        if (depth >= MAX_DEPTH) return '{…}';
        return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, trimValue(inner, depth + 1)]));
    }
    return value;
}

/** Keeps object results small enough for the prompt. */
export function trimForModel(value: unknown, maxChars = MAX_OBJECT_RESULT_CHARS): unknown {
    const trimmed = trimValue(value, 0);
    const json = JSON.stringify(trimmed);
    if (json === undefined || json.length <= maxChars) return trimmed;
    return { truncated: true, note: `Result trimmed to ${maxChars} characters`, preview: json.slice(0, maxChars) };
}

function stripSuccessStatus(value: unknown): unknown {
    if (!isRecord(value) || value.status !== 'success') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'status'));
}

interface StreamOutcome {
    sample: JsonRecord[];
    notices: string[];
    errorRows: { message: string; errorType?: string }[];
    malformedAfter?: number;
    lineTooLong?: boolean;
    readFailure?: { timedOut: boolean; message: string };
    rows: number;
}

interface StreamFailure {
    code: ToolErrorCode;
    message: string;
    errorType?: string;
}

/** Any error row, a malformed line, a lost connection or a timeout means the handle is incomplete. */
function streamFailure(outcome: StreamOutcome): StreamFailure | undefined {
    if (outcome.readFailure) {
        return { code: outcome.readFailure.timedOut ? 'timeout' : 'stream_error', message: outcome.readFailure.message };
    }
    if (outcome.lineTooLong) {
        return { code: 'stream_error', message: `The stream sent a line longer than ${MAX_LINE_CHARS} characters` };
    }
    if (outcome.malformedAfter !== undefined) {
        return { code: 'stream_error', message: `The stream sent a malformed line after ${outcome.malformedAfter} rows` };
    }
    if (outcome.errorRows.length > 0) {
        const last = outcome.errorRows[outcome.errorRows.length - 1];
        const count = outcome.errorRows.length;
        return {
            code: 'stream_error',
            message: count === 1 ? last.message : `${count} error rows in the stream, last: ${last.message}`,
            errorType: last.errorType,
        };
    }
    return undefined;
}

/** Drops the success status of the view model. Progress and notice envelope rows never get here; data rows keep every other field. */
function cleanRow(value: JsonRecord): JsonRecord {
    return Object.fromEntries(Object.entries(value).filter(([key, inner]) => !(key === 'status' && inner === 'success')));
}

function sampleRow(row: JsonRecord): JsonRecord {
    return Object.fromEntries(
        Object.entries(row).map(([key, value]) => {
            const text = typeof value === 'string' ? value : isRecord(value) || Array.isArray(value) ? JSON.stringify(value) : undefined;
            if (text === undefined) return [key, value];
            return [key, text.length > MAX_SAMPLE_STRING_CHARS ? `${text.slice(0, MAX_SAMPLE_STRING_CHARS)}…` : text];
        }),
    );
}

const STOP = Symbol('stop');

function handleLine(raw: string, outcome: StreamOutcome): JsonRecord | undefined | typeof STOP {
    const line = raw.trim();
    if (line === '') return undefined;
    if (line.length > MAX_LINE_CHARS) {
        outcome.lineTooLong = true;
        return STOP;
    }
    let value: unknown;
    try {
        value = JSON.parse(line);
    } catch {
        outcome.malformedAfter = outcome.rows;
        return STOP;
    }
    if (!isRecord(value)) {
        outcome.malformedAfter = outcome.rows;
        return STOP;
    }
    if (value.status === 'error') {
        outcome.errorRows.push({ message: messageFrom(value) ?? 'Unknown error', errorType: errorTypeFrom(value) });
        return undefined;
    }
    if (value.kind === 'progress') return undefined;
    if (value.kind === 'notice') {
        if (isRecord(value.notice) && typeof value.notice.message === 'string')
            outcome.notices.push(value.notice.message.slice(0, MAX_MESSAGE_CHARS));
        return undefined;
    }
    const row = scrubSecrets(cleanRow(value)) as JsonRecord;
    outcome.rows += 1;
    if (outcome.sample.length < SAMPLE_SIZE) outcome.sample.push(sampleRow(row));
    return row;
}

interface ReadContext {
    isCallerAborted(): boolean;
    isTimedOut(): boolean;
    timeoutMs: number;
    /** Aborts on Stop or timeout; a read that hangs is cut loose by it. */
    signal: AbortSignal;
}

/** reader.read() that also settles when the signal aborts, for sources that stop yielding without erroring. */
function readOrAbort(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal): Promise<ReadableStreamReadResult<Uint8Array>> {
    const read = reader.read();
    if (signal.aborted) {
        read.catch(() => undefined);
        return Promise.reject(abortError());
    }
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(abortError());
        signal.addEventListener('abort', onAbort, { once: true });
        read.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
}

/** Reads NDJSON rows (list routes answer text/event-stream with one JSON object per line). Never throws for a failed stream; it records the failure in `outcome` and ends. */
async function* readNdjsonRows(body: ReadableStream<Uint8Array>, outcome: StreamOutcome, ctx: ReadContext): AsyncGenerator<JsonRecord> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let scanned = 0;
    let finished = false;
    try {
        for (;;) {
            let chunk: ReadableStreamReadResult<Uint8Array>;
            try {
                chunk = await readOrAbort(reader, ctx.signal);
            } catch (error) {
                if (ctx.isCallerAborted()) throw abortError();
                outcome.readFailure = ctx.isTimedOut()
                    ? { timedOut: true, message: `Timed out after ${ctx.timeoutMs / 1000}s` }
                    : { timedOut: false, message: `Connection lost: ${errorMessage(error)}` };
                return;
            }
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            let newline = buffer.indexOf('\n', scanned);
            while (newline !== -1) {
                const result = handleLine(buffer.slice(0, newline), outcome);
                buffer = buffer.slice(newline + 1);
                if (result === STOP) return;
                if (result) yield result;
                newline = buffer.indexOf('\n');
            }
            scanned = buffer.length;
            if (buffer.length > MAX_LINE_CHARS) {
                outcome.lineTooLong = true;
                return;
            }
        }
        buffer += decoder.decode();
        const tail = handleLine(buffer, outcome);
        finished = true;
        if (tail && tail !== STOP) yield tail;
    } finally {
        if (!finished) await reader.cancel().catch(() => undefined);
        try {
            reader.releaseLock();
        } catch {
            // already released
        }
    }
}

/**
 * Runs one feature tool against its same-origin /api/feature route with the user's cookie session.
 * Never throws: every failure becomes a ToolError for the model.
 */
export async function executeFeatureTool(spec: ToolSpec<any>, rawArgs: unknown, deps: FeatureExecutionDeps): Promise<unknown | ToolError> {
    if (spec.executor !== 'feature' || !spec.route) return toolError('unavailable', `${spec.name} is not a feature tool`);
    const parsed = spec.input.safeParse(rawArgs ?? {});
    if (!parsed.success) {
        const issues = parsed.error.issues.map(issue => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ');
        return toolError('invalid_args', issues);
    }
    const args: unknown = parsed.data;
    if (deps.signal.aborted) return toolError('aborted', 'Stopped by the user');

    const timeoutMs = deps.timeoutMs ?? FEATURE_TOOL_TIMEOUT_MS;
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    deps.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);
    const stopped = (): ToolError | undefined => {
        if (deps.signal.aborted) return toolError('aborted', 'Stopped by the user');
        if (timedOut) return toolError('timeout', `No answer from ${spec.route?.path} within ${timeoutMs / 1000}s`);
        return undefined;
    };

    try {
        const { url, init } = buildFeatureRequest(spec.route, args);
        const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
        let response: Response;
        try {
            response = await fetchImpl(url, {
                ...init,
                headers: {
                    Accept: 'application/json, text/event-stream',
                    ...(init.headers as Record<string, string> | undefined),
                    ...(deps.expectedAccount ? { [ASSISTANT_ACCOUNT_HEADER]: deps.expectedAccount } : {}),
                },
                credentials: 'same-origin',
                redirect: 'manual',
                cache: 'no-store',
                signal: controller.signal,
            });
        } catch (error) {
            return stopped() ?? toolError('unavailable', `Request failed: ${errorMessage(error)}`);
        }

        if (isLoginRedirect(response)) {
            await response.body?.cancel().catch(() => undefined);
            return toolError('session_expired', SESSION_EXPIRED_MESSAGE);
        }
        if (!response.ok) {
            const body = await readJsonSafely(response);
            if (response.status === 409 && errorTypeFrom(body) === ACCOUNT_MISMATCH_ERROR_TYPE) {
                // The server refused before calling Rucio, so nothing was read
                return toolError('denied_by_policy', ACCOUNT_CHANGED_READ_MESSAGE, ACCOUNT_MISMATCH_ERROR_TYPE);
            }
            return toolError(errorCodeForStatus(response.status), messageFrom(body) ?? `HTTP ${response.status}`, errorTypeFrom(body));
        }

        if (spec.output === 'rows') {
            return await ingestStream(spec, args, response, deps, {
                isCallerAborted: () => deps.signal.aborted,
                isTimedOut: () => timedOut,
                timeoutMs,
                signal: controller.signal,
            });
        }

        let text: string;
        try {
            text = await response.text();
        } catch (error) {
            return stopped() ?? toolError('stream_error', `Could not read the response: ${errorMessage(error)}`);
        }
        let body: unknown;
        try {
            body = text === '' ? {} : JSON.parse(text);
        } catch {
            return toolError('rucio_error', 'The server answered with something that is not JSON');
        }
        if (isRecord(body) && body.status === 'error') {
            return toolError('rucio_error', messageFrom(body) ?? 'Rucio returned an error', errorTypeFrom(body));
        }
        return trimForModel(scrubSecrets(stripSuccessStatus(body)));
    } finally {
        clearTimeout(timer);
        deps.signal.removeEventListener('abort', onAbort);
        controller.abort();
    }
}

async function ingestStream(
    spec: ToolSpec<any>,
    args: unknown,
    response: Response,
    deps: FeatureExecutionDeps,
    ctx: ReadContext,
): Promise<RowsToolResult | ToolError> {
    if (!response.body) return toolError('stream_error', 'The server sent no data');
    const outcome: StreamOutcome = { sample: [], notices: [], errorRows: [], rows: 0 };
    const source = readNdjsonRows(response.body, outcome, ctx);

    // The store gets its own signal: Stop aborts it at once; the timeout aborts it at once too, unless the read itself
    // timed out, in which case the store gets a short grace period to keep the rows already read.
    const storeController = new AbortController();
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    let reading = false;
    let settled = false;
    const onStop = () => {
        if (deps.signal.aborted || !reading) storeController.abort();
    };
    ctx.signal.addEventListener('abort', onStop, { once: true });
    const onReadEnd = () => {
        reading = false;
        if (!settled && ctx.isTimedOut() && !deps.signal.aborted) graceTimer = setTimeout(() => storeController.abort(), ENGINE_GRACE_MS);
    };
    const stoppedError = (): ToolError =>
        deps.signal.aborted || !ctx.isTimedOut()
            ? toolError('aborted', 'Stopped by the user')
            : toolError('timeout', `No answer from ${spec.route?.path} within ${ctx.timeoutMs / 1000}s`);

    try {
        // Peek at the first row: a failure before any row must not replace an existing table (refresh keeps its old data).
        let first: IteratorResult<JsonRecord>;
        try {
            first = await source.next();
        } catch (error) {
            if (deps.signal.aborted || isAbortError(error)) return toolError('aborted', 'Stopped by the user');
            return toolError('unavailable', `Could not read the stream: ${errorMessage(error)}`);
        }
        if (first.done) {
            const failure = streamFailure(outcome);
            if (failure) {
                return toolError(
                    failure.code === 'stream_error' && outcome.errorRows.length > 0 ? 'rucio_error' : failure.code,
                    failure.message,
                    failure.errorType,
                );
            }
        }
        const rows = (async function* () {
            try {
                if (!first.done) {
                    yield first.value;
                    for (;;) {
                        reading = true;
                        const next = await source.next();
                        reading = false;
                        if (next.done) break;
                        yield next.value;
                    }
                }
            } finally {
                await source.return(undefined).catch(() => undefined);
                onReadEnd();
            }
        })();

        const aborted = new Promise<never>((_resolve, reject) => {
            storeController.signal.addEventListener('abort', () => reject(abortError()), { once: true });
        });
        aborted.catch(() => undefined);
        let handle: DataHandle;
        try {
            handle = await Promise.race([
                deps.handles.ingestRows(
                    baseNameFor(spec.name),
                    { toolName: spec.name, args, fetchedAt: (deps.now ?? (() => new Date()))().toISOString() },
                    rows,
                    {
                        rowCap: deps.rowCap ?? defaultRowCap(),
                        signal: storeController.signal,
                        ...(deps.tableName !== undefined ? { name: deps.tableName } : {}),
                        sourceError: () => streamFailure(outcome)?.message,
                    },
                ),
                aborted,
            ]);
        } catch (error) {
            if (deps.signal.aborted || storeController.signal.aborted || isAbortError(error)) return stoppedError();
            if (error instanceof DataHandleStoreError) return toolError(error.code === 'unavailable' ? 'unavailable' : 'invalid_args', error.message);
            return toolError('unavailable', `Could not store the rows: ${errorMessage(error)}`);
        }

        const failure = streamFailure(outcome);
        const result: RowsToolResult = {
            handle: handle.name,
            rowCount: handle.rowCount,
            truncated: handle.truncated,
            columns: handle.columns.map(column => column.name),
            sample: outcome.sample,
        };
        if (failure) result.error = toolError(failure.code, `Stream failed after ${handle.rowCount} rows: ${failure.message}`, failure.errorType);
        if (outcome.notices.length > 0) result.notices = outcome.notices;
        return result;
    } finally {
        settled = true;
        clearTimeout(graceTimer);
        // The wrapper only closes the source once the store iterates it; close it here too (a no-op when already done).
        await source.return(undefined).catch(() => undefined);
        ctx.signal.removeEventListener('abort', onStop);
    }
}

/** Turns a feature ToolSpec into a RegisteredTool. Phases 4 and 7 use this for their routes too. */
export function createFeatureTool<I>(spec: ToolSpec<I>): RegisteredTool<I> {
    return {
        spec,
        execute: async (args, ctx) => {
            // Fail closed: without the account the server cannot check the session still matches it
            if (!ctx.accountKey) return toolError('denied_by_policy', 'The signed-in account is unknown, so nothing was read.');
            return executeFeatureTool(spec as ToolSpec<any>, args, { signal: ctx.signal, handles: ctx.handles, expectedAccount: ctx.accountKey });
        },
    };
}
