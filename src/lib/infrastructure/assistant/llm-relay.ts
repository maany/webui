import 'server-only';
import 'reflect-metadata';
import { NextRequest, NextResponse } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import GATEWAYS from '@/lib/infrastructure/ioc/ioc-symbols-gateway';
import type FeatureConfigGatewayOutputPort from '@/lib/core/port/secondary/feature-config-gateway-output-port';
import type AssistantConfigGatewayOutputPort from '@/lib/core/port/secondary/assistant-config-gateway-output-port';
import type { AssistantRelayConfig } from '@/lib/core/port/secondary/assistant-config-gateway-output-port';
import { getSessionUser } from '@/lib/infrastructure/auth/nextauth-session-utils';
import { relayRateLimiter, relayStreamLimiter } from './relay-rate-limiter';
import { buildUpstreamHeaders, buildUpstreamUrl } from './relay-upstream';
import { CHAT_PATHS, checkTurnScope, extractNewUserTurnText } from './relay-scope';
import { ASSISTANT_SCOPE_HEADER, ASSISTANT_SCOPE_OFF_TOPIC, OFF_TOPIC_ERROR, OFF_TOPIC_MESSAGE } from './runner-errors';
import { parseContentLength, readCappedBody } from './read-capped-body';

/** The only upstream paths the relay forwards, per operator provider kind. */
export const RELAY_ALLOWED_PATHS: Record<AssistantRelayConfig['kind'], Record<string, 'GET' | 'POST'>> = {
    'openai-compatible': { 'chat/completions': 'POST', models: 'GET' },
    anthropic: { 'v1/messages': 'POST' },
};

export const RELAY_MAX_BODY_BYTES = 10 * 1024 * 1024;
export const RELAY_MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

const PASSTHROUGH_RESPONSE_HEADERS = ['content-type', 'retry-after'];

function reply(status: number, error: string, headers?: Record<string, string>): Response {
    return NextResponse.json({ error }, { status, headers });
}

/**
 * Pipes the upstream body through, erroring the stream and cancelling upstream when no chunk arrives
 * for idleMs, the total exceeds maxBytes or the deadline signal aborts. onDone runs once the stream ends, errors or is cancelled.
 */
export function guardBody(
    source: ReadableStream<Uint8Array>,
    idleMs: number,
    maxBytes: number,
    onDone: () => void,
    deadline?: AbortSignal,
): ReadableStream<Uint8Array> {
    const reader = source.getReader();
    let total = 0;
    let finished = false;
    const finish = () => {
        if (!finished) {
            finished = true;
            onDone();
        }
    };
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            let onAbort: (() => void) | undefined;
            try {
                const idle = new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error('idle')), idleMs);
                });
                const aborted = new Promise<never>((_, reject) => {
                    if (!deadline) return;
                    if (deadline.aborted) reject(new Error('deadline'));
                    else {
                        onAbort = () => reject(new Error('deadline'));
                        deadline.addEventListener('abort', onAbort, { once: true });
                    }
                });
                aborted.catch(() => undefined);
                const { done, value } = await Promise.race([reader.read(), idle, aborted]);
                if (finished) return;
                if (done) {
                    finish();
                    controller.close();
                    return;
                }
                total += value.byteLength;
                if (total > maxBytes) throw new Error('too_large');
                controller.enqueue(value);
            } catch (error) {
                if (finished) return;
                console.error('[assistant relay] upstream body aborted');
                await reader.cancel().catch(() => undefined);
                finish();
                controller.error(error);
            } finally {
                clearTimeout(timer);
                if (onAbort) deadline?.removeEventListener('abort', onAbort);
            }
        },
        async cancel(reason) {
            await reader.cancel(reason).catch(() => undefined);
            finish();
        },
    });
}

function hasOwnPath(paths: Record<string, 'GET' | 'POST'>, subpath: string): boolean {
    return Object.prototype.hasOwnProperty.call(paths, subpath);
}

/**
 * Forwards one request from the browser to the operator model at ASSISTANT_DEFAULT_BASE_URL.
 * Checks, in order: assistant flag, session, operator config, allow-listed subpath and method,
 * per-session rate limit, JSON body. Only content-type and accept are forwarded; the operator
 * key is injected here. The upstream body is streamed back unchanged. Bodies are never logged.
 */
export async function relayLlmRequest(request: NextRequest, path: string[]): Promise<Response> {
    const features = appContainer.get<FeatureConfigGatewayOutputPort>(GATEWAYS.FEATURE_CONFIG);
    if (!(await features.isEnabled('assistant'))) return reply(404, 'Not found');

    const user = await getSessionUser();
    if (!user || !user.isLoggedIn) return reply(401, 'unauthorized');

    const relay = await appContainer.get<AssistantConfigGatewayOutputPort>(GATEWAYS.ASSISTANT_CONFIG).getRelayConfig();
    if (!relay) return reply(404, 'Not found');

    const subpath = path.join('/');
    const allowed = RELAY_ALLOWED_PATHS[relay.kind];
    if (!hasOwnPath(allowed, subpath)) return reply(404, 'Not found');
    const method = allowed[subpath];
    if (request.method !== method) return reply(405, 'method_not_allowed', { Allow: method });

    const upstreamUrl = buildUpstreamUrl(relay.baseURL, subpath);
    if (!upstreamUrl) {
        console.error('[assistant relay] operator base URL is invalid');
        return reply(502, 'upstream_misconfigured');
    }

    const accountKey = `${user.rucioIdentity}|${user.rucioAccount}@${user.rucioVO}`;
    const decision = relayRateLimiter.hit(accountKey, relay.rateLimitPerMinute);
    if (!decision.allowed) return reply(429, 'rate_limited', { 'Retry-After': String(decision.retryAfterSeconds) });

    let body: string | undefined;
    if (method === 'POST') {
        const contentType = request.headers.get('content-type') ?? '';
        if (contentType.split(';')[0].trim().toLowerCase() !== 'application/json') return reply(415, 'unsupported_media_type');
        const declaredLength = parseContentLength(request.headers.get('content-length'));
        if (declaredLength === null) return reply(400, 'invalid_content_length');
        if (declaredLength !== undefined && declaredLength >= RELAY_MAX_BODY_BYTES) return reply(413, 'payload_too_large');
        let bytes: Uint8Array | undefined;
        try {
            bytes = await readCappedBody(request, RELAY_MAX_BODY_BYTES - 1);
        } catch {
            return reply(400, 'unreadable_body');
        }
        if (!bytes) return reply(413, 'payload_too_large');
        body = new TextDecoder().decode(bytes);
    }

    // Topic check of new user turns. After the body read and the rate limit hit, before the stream slot is taken.
    let offTopic = false;
    if (method === 'POST' && body !== undefined && relay.scope.mode !== 'off' && subpath === CHAT_PATHS[relay.kind]) {
        const text = extractNewUserTurnText(relay.kind, body);
        if (text !== undefined && (await checkTurnScope(relay, accountKey, text, request.signal ?? undefined)) === 'OFF') {
            if (relay.scope.mode === 'block') {
                return NextResponse.json(
                    { error: OFF_TOPIC_ERROR, message: OFF_TOPIC_MESSAGE },
                    { status: 403, headers: { 'cache-control': 'no-store' } },
                );
            }
            offTopic = true;
        }
    }

    const headers = buildUpstreamHeaders(relay, request.headers.get('accept') ?? 'application/json', body !== undefined);

    const releaseSlot = relayStreamLimiter.tryAcquire(accountKey, relay.maxConcurrentStreams);
    if (!releaseSlot) {
        return NextResponse.json(
            {
                error: 'too_many_streams',
                message: 'Too many assistant replies are running for this account. Wait for one to finish and try again.',
            },
            { status: 429 },
        );
    }

    const timeoutMs = relay.upstreamTimeoutMs;
    const controller = new AbortController();
    let timedOut = false;
    // cleanup() is idempotent and declared below; the handlers only run after it exists.
    const onClientAbort = () => {
        controller.abort();
        cleanup();
    };
    // Some runtimes (jsdom) expose no request signal.
    const clientSignal: AbortSignal | undefined = request.signal ?? undefined;
    if (clientSignal?.aborted) controller.abort();
    else clientSignal?.addEventListener('abort', onClientAbort, { once: true });
    const headerTimer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);
    // Total deadline: bounds an upstream that keeps the connection alive by dripping chunks.
    // Frees the slot even when the consumer is backpressured and no pull is pending to notice the abort.
    const deadlineTimer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        cleanup();
    }, relay.upstreamMaxMs);
    const cleanup = () => {
        clearTimeout(headerTimer);
        clearTimeout(deadlineTimer);
        clientSignal?.removeEventListener('abort', onClientAbort);
        // Every exit path ends in cleanup(); the release is idempotent.
        releaseSlot();
    };

    let upstream: Response;
    try {
        upstream = await fetch(upstreamUrl, {
            method,
            headers,
            body,
            signal: controller.signal,
            redirect: 'manual',
            cache: 'no-store',
        });
    } catch {
        cleanup();
        if (timedOut) {
            console.error('[assistant relay] upstream timed out');
            return reply(504, 'upstream_timeout');
        }
        console.error('[assistant relay] upstream request failed');
        return reply(502, 'upstream_unreachable');
    }
    clearTimeout(headerTimer);

    if (upstream.status >= 300 && upstream.status < 400) {
        console.error('[assistant relay] upstream answered with a redirect, not following it');
        try {
            await upstream.body?.cancel();
        } catch {
            // the connection is released best-effort
        }
        cleanup();
        return reply(502, 'upstream_redirect');
    }

    const responseHeaders = new Headers({ 'cache-control': 'no-store' });
    if (offTopic) responseHeaders.set(ASSISTANT_SCOPE_HEADER, ASSISTANT_SCOPE_OFF_TOPIC);
    PASSTHROUGH_RESPONSE_HEADERS.forEach(name => {
        const value = upstream.headers.get(name);
        if (value !== null) responseHeaders.set(name, value);
    });
    if (!upstream.body || typeof upstream.body.getReader !== 'function') {
        // No body, or a runtime whose body is not a web stream (jsdom test polyfill): nothing to guard.
        cleanup();
        return new Response(upstream.body ?? null, { status: upstream.status, headers: responseHeaders });
    }
    const guarded = guardBody(
        upstream.body,
        timeoutMs,
        RELAY_MAX_RESPONSE_BYTES,
        () => {
            cleanup();
            controller.abort();
        },
        controller.signal,
    );
    return new Response(guarded, { status: upstream.status, headers: responseHeaders });
}
