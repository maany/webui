import type { HttpMethod, ToolError, ToolErrorCode } from '@/lib/core/entity/assistant/tool';
import { scrubSecrets } from './feature-executor';
import { toolError } from './tool-error';

/** Writes give up after 60s. The change may still land on the server, so the error says so. */
export const WRITE_TIMEOUT_MS = 60_000;
const MAX_MESSAGE_CHARS = 500;
const MAX_ERROR_TYPE_CHARS = 100;

/** The part of `Response` the executor reads, so tests can fake opaque redirects. */
export interface FetchResponseLike {
    ok: boolean;
    status: number;
    type: string;
    redirected: boolean;
    url: string;
    headers: { get(name: string): string | null };
    text(): Promise<string>;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<FetchResponseLike>;

export interface WriteRoute {
    path: string;
    method: HttpMethod;
}

export interface WriteRequestOptions {
    fetchImpl?: FetchLike;
    timeoutMs?: number;
}

export const SESSION_EXPIRED_ERROR: ToolError = {
    error: 'session_expired',
    message: 'The WebUI session has expired. Ask the user to log in again, then retry.',
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function codeForStatus(status: number): ToolErrorCode {
    if (status === 400 || status === 422) return 'invalid_args';
    if (status === 401) return 'unauthorized';
    if (status === 403) return 'forbidden';
    if (status === 404) return 'not_found';
    if (status === 408 || status === 504) return 'timeout';
    return 'rucio_error';
}

function pickMessage(body: Record<string, unknown>): string | undefined {
    if (typeof body.message === 'string' && body.message.length > 0) return body.message.slice(0, MAX_MESSAGE_CHARS);
    if (typeof body.error === 'string' && body.error.length > 0) return body.error.slice(0, MAX_MESSAGE_CHARS);
    return undefined;
}

/** Turns a write route answer into the view model or a typed ToolError. Never throws on HTML or bad JSON. */
export async function interpretWriteResponse(res: FetchResponseLike): Promise<unknown> {
    // src/proxy.ts answers unauthenticated /api/feature/* requests with a 302 to the login page
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) return SESSION_EXPIRED_ERROR;
    if (res.redirected && res.url.includes('/auth/login')) return SESSION_EXPIRED_ERROR;

    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.includes('application/json')) {
        if (contentType.includes('text/html')) return SESSION_EXPIRED_ERROR;
        return toolError(res.ok ? 'rucio_error' : codeForStatus(res.status), `The server answered ${res.status} without JSON.`);
    }

    let body: unknown;
    try {
        const text = await res.text();
        body = text.length > 0 ? JSON.parse(text) : {};
    } catch {
        return toolError('rucio_error', `The server answered ${res.status} with invalid JSON.`);
    }

    const record = isRecord(body) ? body : {};
    const errorType = typeof record.errorType === 'string' ? record.errorType.slice(0, MAX_ERROR_TYPE_CHARS) : undefined;
    if (!res.ok) return toolError(codeForStatus(res.status), pickMessage(record) ?? `The server answered ${res.status}.`, errorType);
    if (record.status === 'error') return toolError('rucio_error', pickMessage(record) ?? 'Rucio reported an error.', errorType);
    // No credential-named field may reach the model, events or storage
    return scrubSecrets(body);
}

/** One same-origin JSON request to a write route. Resolves to the view model or a ToolError, never rejects. */
export async function executeWriteRequest(
    route: WriteRoute,
    body: unknown,
    signal: AbortSignal,
    options: WriteRequestOptions = {},
): Promise<unknown> {
    const timeoutMs = options.timeoutMs ?? WRITE_TIMEOUT_MS;
    if (signal.aborted) return toolError('aborted', 'Stopped before the request was sent. Nothing changed.');

    const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });

    try {
        const res = await fetchImpl(route.path, {
            method: route.method,
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(body),
            credentials: 'same-origin',
            redirect: 'manual',
            signal: controller.signal,
        });
        return await interpretWriteResponse(res);
    } catch {
        if (timedOut) {
            return toolError(
                'timeout',
                `No answer after ${Math.round(timeoutMs / 1000)}s. The change may still have been applied, so check its state before retrying.`,
            );
        }
        if (signal.aborted) {
            return toolError('aborted', 'Stopped by the user. The change may still have been applied, so check its state before retrying.');
        }
        return toolError('unavailable', 'The WebUI server could not be reached.');
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
    }
}
