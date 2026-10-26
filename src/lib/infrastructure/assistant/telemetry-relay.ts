import 'server-only';
import type { AssistantTelemetryRelayConfig } from '@/lib/core/port/secondary/assistant-config-gateway-output-port';
import { SlidingWindowRateLimiter, type RateLimitDecision } from '@/lib/infrastructure/assistant/relay-rate-limiter';
import { hashAccountKey, rewriteOtlpUserIds } from '@/lib/infrastructure/assistant/telemetry-user-hash';

export const TELEMETRY_RELAY_MAX_BYTES = 1048576;
export const TELEMETRY_RELAY_TIMEOUT_MS = 10000;
/** OTLP/HTTP JSON only: the relay must be able to parse the export to hash user ids. */
export const TELEMETRY_RELAY_CONTENT_TYPE = 'application/json';

/** One telemetry limiter per server process, separate from the LLM relay's so telemetry never uses up the LLM budget. */
export const telemetryRelayRateLimiter = new SlidingWindowRateLimiter();

export interface TelemetryRelaySession {
    /** Per-session rate limit key: `rucioIdentity|account@vo`. */
    rateLimitKey: string;
    /** `account@vo` of the signed-in session; the only account the relay hashes. */
    accountKey: string;
}

export interface TelemetryRelayDeps {
    assistantEnabled(): Promise<boolean>;
    /** The signed-in session, or undefined when not signed in. */
    session(): Promise<TelemetryRelaySession | undefined>;
    /** Operator sink from env, or undefined when the operator sink is not usable (see getTelemetryRelayConfig). */
    upstream(): Promise<AssistantTelemetryRelayConfig | undefined>;
    rateLimit(rateLimitKey: string, limitPerMinute: number): Promise<RateLimitDecision>;
    fetchImpl: typeof fetch;
}

function json(body: Record<string, unknown>, status: number, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/**
 * Reads the request body up to maxBytes. Returns undefined as soon as the total exceeds the cap
 * (the reader is cancelled), so a chunked body without content-length cannot be buffered unbounded.
 * Bodies that are not web streams are read whole and size-checked afterwards.
 */
async function readCappedBody(request: Request, maxBytes: number): Promise<Uint8Array | undefined> {
    if (!request.body) {
        return new Uint8Array(0);
    }
    if (typeof request.body.getReader !== 'function') {
        // A runtime whose body is not a web stream (jsdom test polyfill): the body is already buffered, so check its size after the fact.
        const buffered = new Uint8Array(await request.arrayBuffer());
        return buffered.byteLength > maxBytes ? undefined : buffered;
    }
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            return undefined;
        }
        chunks.push(value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return body;
}

/**
 * Same-origin OTLP relay for the operator sink. Forwards the body to the env endpoint with the
 * env headers; with hashUser on, user ids become the salted HMAC of the session account first.
 * Never forwards client headers (cookies, auth) and never logs bodies.
 */
export async function relayTelemetry(request: Request, deps: TelemetryRelayDeps): Promise<Response> {
    if (!(await deps.assistantEnabled())) {
        return json({ error: 'Not found' }, 404);
    }
    const session = await deps.session();
    if (!session) {
        return json({ error: 'Unauthorized' }, 401);
    }
    const upstream = await deps.upstream();
    if (!upstream || (upstream.hashUser && !upstream.userSalt)) {
        return json({ error: 'Not found' }, 404);
    }
    const contentType = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (contentType !== TELEMETRY_RELAY_CONTENT_TYPE) {
        return json({ error: 'Unsupported content type, send OTLP/HTTP JSON' }, 415);
    }
    const declaredLength = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > TELEMETRY_RELAY_MAX_BYTES) {
        return json({ error: 'Payload too large' }, 413);
    }
    const decision = await deps.rateLimit(session.rateLimitKey, upstream.rateLimitPerMinute);
    if (!decision.allowed) {
        return json({ error: 'Too many requests' }, 429, { 'retry-after': String(decision.retryAfterSeconds) });
    }
    const body = await readCappedBody(request, TELEMETRY_RELAY_MAX_BYTES);
    if (!body) {
        return json({ error: 'Payload too large' }, 413);
    }
    let forwarded: Uint8Array | string = body;
    if (upstream.hashUser && upstream.userSalt) {
        let payload: unknown;
        try {
            payload = JSON.parse(new TextDecoder().decode(body));
        } catch {
            return json({ error: 'Body is not OTLP JSON' }, 400);
        }
        const hashedUserId = hashAccountKey(upstream.userSalt, session.accountKey);
        forwarded = JSON.stringify(rewriteOtlpUserIds(payload, { accountKey: session.accountKey, hashedUserId }));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TELEMETRY_RELAY_TIMEOUT_MS);
    try {
        const response = await deps.fetchImpl(upstream.endpoint, {
            method: 'POST',
            headers: { ...upstream.headers, 'content-type': contentType },
            body: forwarded,
            redirect: 'error',
            signal: controller.signal,
        });
        if (response.ok) {
            return json({}, 200);
        }
        if (response.status === 429) {
            return json({ error: 'Upstream rate limited' }, 429, { 'retry-after': response.headers.get('retry-after') ?? '10' });
        }
        if (response.status >= 500) {
            return json({ error: 'Upstream unavailable' }, 503);
        }
        return json({ error: 'Upstream rejected the export', status: response.status }, 500);
    } catch (error) {
        console.error('assistant telemetry relay: upstream request failed', error instanceof Error ? error.name : 'unknown');
        return json({ error: 'Upstream unreachable' }, 504);
    } finally {
        clearTimeout(timer);
    }
}
