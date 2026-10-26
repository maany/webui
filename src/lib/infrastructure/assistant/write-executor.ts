import type { HttpMethod } from '@/lib/core/entity/assistant/tool';
import { SESSION_EXPIRED_MESSAGE, errorCodeForStatus, scrubSecrets, trimForModel } from './feature-executor';
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

export const MAY_HAVE_LANDED = 'The change may still have been applied, so check its state before retrying.';
const sessionExpired = () => toolError('session_expired', SESSION_EXPIRED_MESSAGE);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A server error says nothing about whether the write landed. */
function withLandedWarning(status: number, message: string): string {
    return status >= 500 ? `${message} ${MAY_HAVE_LANDED}` : message;
}

function pickMessage(body: Record<string, unknown>): string | undefined {
    if (typeof body.message === 'string' && body.message.length > 0) return body.message.slice(0, MAX_MESSAGE_CHARS);
    if (typeof body.error === 'string' && body.error.length > 0) return body.error.slice(0, MAX_MESSAGE_CHARS);
    return undefined;
}

/**
 * Turns a write route answer into the view model or a typed ToolError. Never throws on HTML or bad JSON.
 * A rejection while reading the body (abort, timeout) propagates so executeWriteRequest can report it.
 */
export async function interpretWriteResponse(res: FetchResponseLike): Promise<unknown> {
    // src/proxy.ts answers unauthenticated /api/feature/* requests with a 302 to the login page
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) return sessionExpired();
    if (res.redirected && res.url.includes('/auth/login')) return sessionExpired();

    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    const isJson = contentType.includes('application/json');
    // The login page is an HTML 2xx; HTML on an error status is a gateway page and maps by status
    if (!isJson && res.ok && contentType.includes('text/html')) return sessionExpired();
    if (!isJson) {
        if (res.ok)
            return toolError(
                'rucio_error',
                `The server answered ${res.status} without JSON. The change was probably applied, so check its state before retrying.`,
            );
        return toolError(errorCodeForStatus(res.status), withLandedWarning(res.status, `The server answered ${res.status} without JSON.`));
    }

    const text = await res.text();
    let body: unknown;
    try {
        body = text.length > 0 ? JSON.parse(text) : {};
    } catch {
        const base = `The server answered ${res.status} with invalid JSON.`;
        return toolError(
            res.ok ? 'rucio_error' : errorCodeForStatus(res.status),
            res.ok ? `${base} The change was probably applied, so check its state before retrying.` : withLandedWarning(res.status, base),
        );
    }

    const record = isRecord(body) ? body : {};
    const errorType = typeof record.errorType === 'string' ? record.errorType.slice(0, MAX_ERROR_TYPE_CHARS) : undefined;
    if (!res.ok) {
        return toolError(
            errorCodeForStatus(res.status),
            withLandedWarning(res.status, pickMessage(record) ?? `The server answered ${res.status}.`),
            errorType,
        );
    }
    if (record.status === 'error') return toolError('rucio_error', pickMessage(record) ?? 'Rucio reported an error.', errorType);
    // No credential-named field may reach the model, events or storage
    return trimForModel(scrubSecrets(body));
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
            return toolError('timeout', `No answer after ${Math.round(timeoutMs / 1000)}s. ${MAY_HAVE_LANDED}`);
        }
        if (signal.aborted) {
            return toolError('aborted', `Stopped by the user. ${MAY_HAVE_LANDED}`);
        }
        return toolError('unavailable', `The WebUI server could not be reached. ${MAY_HAVE_LANDED}`);
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
    }
}
