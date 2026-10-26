import 'server-only';
import 'reflect-metadata';
import { NextRequest, NextResponse } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import GATEWAYS from '@/lib/infrastructure/ioc/ioc-symbols-gateway';
import type FeatureConfigGatewayOutputPort from '@/lib/core/port/secondary/feature-config-gateway-output-port';
import type AssistantConfigGatewayOutputPort from '@/lib/core/port/secondary/assistant-config-gateway-output-port';
import type { AssistantRelayConfig } from '@/lib/core/port/secondary/assistant-config-gateway-output-port';
import { getSessionUser } from '@/lib/infrastructure/auth/nextauth-session-utils';
import { relayRateLimiter } from './relay-rate-limiter';
import { ANTHROPIC_API_VERSION } from './provider-kinds';

/** The only upstream paths the relay forwards, per operator provider kind. */
export const RELAY_ALLOWED_PATHS: Record<AssistantRelayConfig['kind'], Record<string, 'GET' | 'POST'>> = {
    'openai-compatible': { 'chat/completions': 'POST', models: 'GET' },
    anthropic: { 'v1/messages': 'POST' },
};

export const RELAY_MAX_BODY_BYTES = 10 * 1024 * 1024;

const PASSTHROUGH_RESPONSE_HEADERS = ['content-type', 'retry-after'];

function reply(status: number, error: string, headers?: Record<string, string>): Response {
    return NextResponse.json({ error }, { status, headers });
}

/**
 * Operator base URL + allow-listed subpath. Query string and hash of the base URL are dropped and
 * trailing slashes of its path are normalised; the subpath never comes from the request.
 */
function buildUpstreamUrl(baseURL: string, subpath: string): string | undefined {
    try {
        const base = new URL(baseURL);
        if (base.protocol !== 'http:' && base.protocol !== 'https:') return undefined;
        return `${base.origin}${base.pathname.replace(/\/+$/, '')}/${subpath}`;
    } catch {
        return undefined;
    }
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

    const decision = relayRateLimiter.hit(`${user.rucioIdentity}|${user.rucioAccount}@${user.rucioVO}`, relay.rateLimitPerMinute);
    if (!decision.allowed) return reply(429, 'rate_limited', { 'Retry-After': String(decision.retryAfterSeconds) });

    let body: string | undefined;
    if (method === 'POST') {
        const contentType = request.headers.get('content-type') ?? '';
        if (!contentType.toLowerCase().includes('application/json')) return reply(415, 'unsupported_media_type');
        const declaredLength = Number(request.headers.get('content-length') ?? '0');
        if (declaredLength > RELAY_MAX_BODY_BYTES) return reply(413, 'payload_too_large');
        body = await request.text();
        if (Buffer.byteLength(body) > RELAY_MAX_BODY_BYTES) return reply(413, 'payload_too_large');
    }

    const headers = new Headers({ accept: request.headers.get('accept') ?? 'application/json' });
    if (body !== undefined) headers.set('content-type', 'application/json');
    if (relay.kind === 'anthropic') {
        headers.set('anthropic-version', ANTHROPIC_API_VERSION);
        if (relay.apiKey) headers.set('x-api-key', relay.apiKey);
    } else if (relay.apiKey) {
        headers.set('authorization', `Bearer ${relay.apiKey}`);
    }

    let upstream: Response;
    try {
        upstream = await fetch(upstreamUrl, {
            method,
            headers,
            body,
            signal: request.signal,
            redirect: 'manual',
            cache: 'no-store',
        });
    } catch {
        console.error('[assistant relay] upstream request failed');
        return reply(502, 'upstream_unreachable');
    }

    if (upstream.status >= 300 && upstream.status < 400) {
        console.error('[assistant relay] upstream answered with a redirect, not following it');
        return reply(502, 'upstream_redirect');
    }

    const responseHeaders = new Headers({ 'cache-control': 'no-store' });
    PASSTHROUGH_RESPONSE_HEADERS.forEach(name => {
        const value = upstream.headers.get(name);
        if (value !== null) responseHeaders.set(name, value);
    });
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
