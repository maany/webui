import 'server-only';
import type { AssistantTelemetryRelayConfig } from '@/lib/core/port/secondary/assistant-config-gateway-output-port';
import { SlidingWindowRateLimiter, type RateLimitDecision } from '@/lib/infrastructure/assistant/relay-rate-limiter';
import { hashAccountKey, rewriteOtlpUserIds } from '@/lib/infrastructure/assistant/telemetry-user-hash';
import { readCappedBody } from './read-capped-body';

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
    /** Every `account@vo` of the session (active plus other logged-in accounts), deduped. */
    accountKeys: string[];
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

/** Best effort: releases the upstream connection; never throws (some runtimes expose a body without cancel). */
async function discardBody(response: Response): Promise<void> {
    try {
        await response.body?.cancel();
    } catch {
        // ignore
    }
}

/** Aborts with either signal: AbortSignal.any when it accepts both (cross-realm signals can throw), else the timeout signal alone. */
function linkSignals(clientSignal: AbortSignal | undefined, timeoutSignal: AbortSignal): AbortSignal {
    if (!clientSignal) {
        return timeoutSignal;
    }
    try {
        if (typeof AbortSignal.any === 'function') {
            return AbortSignal.any([clientSignal, timeoutSignal]);
        }
    } catch {
        // fall through to the timeout signal
    }
    return timeoutSignal;
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
    let body: Uint8Array | undefined;
    try {
        body = await readCappedBody(request, TELEMETRY_RELAY_MAX_BYTES);
    } catch {
        return json({ error: 'Request body could not be read' }, 400);
    }
    if (!body) {
        return json({ error: 'Payload too large' }, 413);
    }
    let forwarded: Uint8Array | string = body;
    if (upstream.hashUser && upstream.userSalt) {
        try {
            const payload: unknown = JSON.parse(new TextDecoder().decode(body));
            const hashedIds: Record<string, string> = {};
            for (const key of session.accountKeys) {
                hashedIds[key] = hashAccountKey(upstream.userSalt, key);
            }
            const defaultHashedUserId = hashAccountKey(upstream.userSalt, session.accountKey);
            forwarded = JSON.stringify(rewriteOtlpUserIds(payload, { accountKeys: session.accountKeys, hashedIds, defaultHashedUserId }));
        } catch {
            return json({ error: 'Body is not OTLP JSON' }, 400);
        }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TELEMETRY_RELAY_TIMEOUT_MS);
    try {
        const headers = new Headers(upstream.headers);
        headers.set('content-type', contentType);
        const signal = linkSignals(request.signal, controller.signal);
        const response = await deps.fetchImpl(upstream.endpoint, {
            method: 'POST',
            headers,
            body: forwarded,
            redirect: 'error',
            signal,
        });
        const status = response.status;
        const upstreamRetryAfter = response.headers.get('retry-after') ?? '';
        // The upstream body is never used: release the connection.
        await discardBody(response);
        if (response.ok) {
            return json({}, 200);
        }
        if (status === 429) {
            return json({ error: 'Upstream rate limited' }, 429, { 'retry-after': /^\d{1,6}$/.test(upstreamRetryAfter) ? upstreamRetryAfter : '10' });
        }
        if (status >= 500) {
            return json({ error: 'Upstream unavailable' }, 503);
        }
        return json({ error: 'Upstream rejected the export', status }, 500);
    } catch (error) {
        console.error('assistant telemetry relay: upstream request failed', error instanceof Error ? error.name : 'unknown');
        return json({ error: 'Upstream unreachable' }, 504);
    } finally {
        clearTimeout(timer);
    }
}
