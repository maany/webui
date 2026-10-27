import type { ResolvedProvider } from '@/lib/core/entity/assistant/provider-config';
import { ANTHROPIC_API_VERSION, CONNECTION_TEST_PROMPT, DEFAULT_BASE_URLS } from './provider-kinds';

export type ConnectionErrorCode = 'cors' | 'lna' | 'mixed-content' | 'auth' | 'no-tools' | 'model-not-found' | 'network' | 'unknown';

export type ConnectionTestResult = { ok: true; latencyMs: number } | { ok: false; code: ConnectionErrorCode; hint: string };

export interface ConnectionTestOptions {
    /** Page origin; defaults to window.location.origin */
    origin?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    now?: () => number;
}

export const CONNECTION_TEST_TIMEOUT_MS = 20_000;
const MAX_TOKENS = 64;
const TOOL_NAME = 'ping';
const TOOL_DESCRIPTION = 'Connection check. Takes no arguments.';
const EMPTY_SCHEMA = { type: 'object', properties: {} };

const fail = (code: ConnectionErrorCode, hint: string): ConnectionTestResult => ({ ok: false, code, hint });

function trimSlashes(url: string): string {
    return url.replace(/\/+$/, '');
}

/** A minimal non-streamed request with one trivial tool, or undefined when the provider has no usable base URL. */
export function buildTestRequest(resolved: ResolvedProvider): { url: string; init: RequestInit } | undefined {
    const base = resolved.baseURL ?? DEFAULT_BASE_URLS[resolved.kind];
    if (!base) return undefined;
    const root = trimSlashes(base);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const direct = resolved.via === 'direct';

    if (resolved.kind === 'anthropic') {
        headers['anthropic-version'] = ANTHROPIC_API_VERSION;
        // The relay injects the key server side; never send credentials on that path.
        if (direct) {
            headers['anthropic-dangerous-direct-browser-access'] = 'true';
            if (resolved.apiKey) headers['x-api-key'] = resolved.apiKey;
        }
        const body = {
            model: resolved.model,
            max_tokens: MAX_TOKENS,
            messages: [{ role: 'user', content: CONNECTION_TEST_PROMPT }],
            tools: [{ name: TOOL_NAME, description: TOOL_DESCRIPTION, input_schema: EMPTY_SCHEMA }],
        };
        return { url: `${root}/v1/messages`, init: { method: 'POST', headers, body: JSON.stringify(body) } };
    }

    if (direct && resolved.apiKey) headers.authorization = `Bearer ${resolved.apiKey}`;
    const url = resolved.kind === 'ollama' && !root.endsWith('/v1') ? `${root}/v1/chat/completions` : `${root}/chat/completions`;
    const limit = resolved.kind === 'openai' ? { max_completion_tokens: MAX_TOKENS } : { max_tokens: MAX_TOKENS };
    const body = {
        model: resolved.model,
        messages: [{ role: 'user', content: CONNECTION_TEST_PROMPT }],
        tools: [{ type: 'function', function: { name: TOOL_NAME, description: TOOL_DESCRIPTION, parameters: EMPTY_SCHEMA } }],
        stream: false,
        ...limit,
    };
    return { url, init: { method: 'POST', headers, body: JSON.stringify(body) } };
}

function isLoopbackHost(hostname: string): boolean {
    const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host);
}

function isPrivateHost(hostname: string): boolean {
    const host = hostname.toLowerCase();
    return (
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
        /^169\.254\./.test(host) ||
        host.endsWith('.local')
    );
}

const isLocalHost = (hostname: string) => isLoopbackHost(hostname) || isPrivateHost(hostname);

async function readErrorMessage(response: Response): Promise<string> {
    let text = '';
    try {
        text = await response.text();
    } catch {
        return '';
    }
    try {
        const parsed = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown };
        const nested = typeof parsed.error === 'object' && parsed.error !== null ? parsed.error.message : parsed.error;
        const message = nested ?? parsed.message;
        if (typeof message === 'string') return message;
    } catch {
        // not JSON, use the raw text
    }
    return text;
}

function shorten(text: string): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > 200 ? `${flat.slice(0, 197)}...` : flat;
}

function httpFailure(resolved: ResolvedProvider, status: number, message: string): ConnectionTestResult {
    if (resolved.via === 'relay') {
        if (status === 401) return fail('auth', 'Your session has expired. Log in again.');
        if (status === 404) return fail('unknown', 'Rucio bot is not available on this server.');
        if (status === 429) return fail('unknown', 'Too many requests to the operator model. Wait a minute and try again.');
        if (status === 502) return fail('network', 'The server could not reach the operator model.');
        if (status === 403) return fail('auth', 'The server refused the request. You may not be allowed to use Rucio bot.');
        if (status >= 500) return fail('network', `The server returned HTTP ${status}. Try again later.`);
    }
    if (status === 401 || status === 403) return fail('auth', 'The provider rejected the API key. Check that it is correct and active.');
    if ((status === 400 || status === 404 || status === 422) && /\btools?\b/i.test(message)) {
        return fail('no-tools', `The model "${resolved.model}" does not support tool calling. Choose a model with tool support.`);
    }
    const aboutMissingModel = /model/i.test(message) && /(not found|does not exist|unknown|invalid)/i.test(message);
    if ((status === 404 && /model/i.test(message)) || ((status === 400 || status === 422) && aboutMissingModel)) {
        const next = resolved.kind === 'ollama' ? ` Run: ollama pull ${resolved.model}` : ' Check the model id.';
        return fail('model-not-found', `The model "${resolved.model}" was not found.${next}`);
    }
    if (status === 404) {
        const v1 = resolved.kind === 'openai-compatible' ? ' (OpenAI-compatible servers usually end in /v1)' : '';
        return fail('unknown', `The endpoint returned 404. Check the base URL${v1}.`);
    }
    if (status === 429) return fail('unknown', 'The provider is rate limiting requests. Try again later.');
    const detail = resolved.apiKey ? shorten(message).split(resolved.apiKey).join('***') : shorten(message);
    return fail('unknown', detail ? `The provider returned HTTP ${status}: ${detail}` : `The provider returned HTTP ${status}.`);
}

function networkFailure(resolved: ResolvedProvider, target: URL, page: URL): ConnectionTestResult {
    const origin = page.origin;
    if (resolved.via === 'relay') return fail('network', 'Could not reach the Rucio WebUI server. Check your connection and try again.');
    if (page.protocol === 'https:' && target.protocol === 'http:' && !isLoopbackHost(target.hostname)) {
        return fail(
            'mixed-content',
            `This page uses HTTPS, so the browser likely blocked a plain HTTP request to ${target.host}. Serve the model over HTTPS, for example behind a Caddy or nginx reverse proxy.`,
        );
    }
    if (isLocalHost(target.hostname) && !isLocalHost(page.hostname)) {
        const serverHint = resolved.kind === 'ollama' ? `start Ollama with OLLAMA_ORIGINS=${origin}` : `allow the origin ${origin} on that server`;
        return fail(
            'lna',
            `The browser likely blocked access to ${target.host} on your local network. Allow local network access when the browser asks, and ${serverHint}`,
        );
    }
    switch (resolved.kind) {
        case 'ollama':
            return fail(
                'cors',
                `Could not reach ${target.host}. Is Ollama running? If it is, it may be rejecting requests from this page: start it with OLLAMA_ORIGINS=${origin} ollama serve`,
            );
        case 'openai-compatible':
            return fail(
                'cors',
                `Could not reach ${target.host}. Likely causes: the server is not running, the URL is wrong, or it rejects requests from this origin. For LiteLLM set LITELLM_CORS_ORIGINS=${origin}. For other servers, allow the origin ${origin}.`,
            );
        case 'openai':
            return fail(
                'network',
                `Could not reach ${target.host}. Likely causes: no network or proxy blocks it, or the API key is invalid or revoked (OpenAI sends no CORS headers on that error).`,
            );
        default:
            return fail(
                'network',
                `Could not reach ${target.host}. Likely causes: no network, a proxy or firewall is blocking it, or the URL is wrong.`,
            );
    }
}

/** Sends one minimal tool-calling request and maps failures to an actionable hint. Never throws. */
export async function testProviderConnection(
    resolved: ResolvedProvider,
    signal: AbortSignal,
    options: ConnectionTestOptions = {},
): Promise<ConnectionTestResult> {
    const doFetch = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    const now = options.now ?? (() => Date.now());
    const timeoutMs = options.timeoutMs ?? CONNECTION_TEST_TIMEOUT_MS;
    const pageOrigin = options.origin ?? (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');

    const request = buildTestRequest(resolved);
    if (!request) return fail('unknown', 'Set a base URL for this provider.');

    let page: URL;
    let target: URL;
    try {
        page = new URL(pageOrigin);
        target = new URL(request.url, page);
    } catch {
        return fail('unknown', 'The base URL is not a valid URL.');
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort);

    const started = now();
    try {
        const response = await doFetch(target.toString(), { ...request.init, signal: controller.signal });
        if (response.ok) return { ok: true, latencyMs: Math.max(0, Math.round(now() - started)) };
        return httpFailure(resolved, response.status, await readErrorMessage(response));
    } catch {
        if (signal.aborted) return fail('network', 'The connection test was cancelled.');
        if (timedOut) {
            const seconds = Math.max(1, Math.round(timeoutMs / 1000));
            return fail(
                'network',
                `No answer within ${seconds} ${seconds === 1 ? 'second' : 'seconds'}. Check the base URL and that the server is running.`,
            );
        }
        return networkFailure(resolved, target, page);
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
    }
}
