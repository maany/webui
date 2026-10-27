import type { AssistantRelayConfig } from '@/lib/core/port/secondary/assistant-config-gateway-output-port';
import { ANTHROPIC_API_VERSION } from './provider-kinds';

/**
 * Operator base URL + allow-listed subpath. Query string and hash of the base URL are dropped and
 * trailing slashes of its path are normalised; the subpath never comes from the request.
 */
export function buildUpstreamUrl(baseURL: string, subpath: string): string | undefined {
    try {
        const base = new URL(baseURL);
        if (base.protocol !== 'http:' && base.protocol !== 'https:') return undefined;
        return `${base.origin}${base.pathname.replace(/\/+$/, '')}/${subpath}`;
    } catch {
        return undefined;
    }
}

/** Headers for an upstream call to the operator model: accept, optional JSON content type and the operator key. */
export function buildUpstreamHeaders(relay: Pick<AssistantRelayConfig, 'kind' | 'apiKey'>, accept: string, hasJsonBody: boolean): Headers {
    const headers = new Headers({ accept });
    if (hasJsonBody) headers.set('content-type', 'application/json');
    if (relay.kind === 'anthropic') {
        headers.set('anthropic-version', ANTHROPIC_API_VERSION);
        if (relay.apiKey) headers.set('x-api-key', relay.apiKey);
    } else if (relay.apiKey) {
        headers.set('authorization', `Bearer ${relay.apiKey}`);
    }
    return headers;
}
