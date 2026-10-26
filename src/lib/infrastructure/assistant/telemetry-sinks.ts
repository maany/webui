import type { AssistantSettings, TelemetrySinkSettings } from '@/lib/core/entity/assistant/settings';

export const ASSISTANT_TELEMETRY_RELAY_PATH = '/api/assistant/telemetry';
export const LANGFUSE_OTLP_TRACES_PATH = '/api/public/otel/v1/traces';
export const LANGFUSE_INGESTION_VERSION_HEADER = 'x-langfuse-ingestion-version';
export const LANGFUSE_INGESTION_VERSION = '4';

/** Where and how an OTLP/HTTP JSON exporter posts. */
export interface OtlpTarget {
    url: string;
    headers: Record<string, string>;
}

export type TelemetryTestFailure = 'invalid-url' | 'mixed-content' | 'network' | 'unauthorized' | 'not-found' | 'timeout' | 'http-error';

export type TelemetryTestResult = { ok: true; status: number } | { ok: false; reason: TelemetryTestFailure; status?: number };

function base64Utf8(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    bytes.forEach(byte => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary);
}

/** Langfuse accepts its base URL; strip a pasted OTLP path so both forms work. */
export function langfuseBaseUrl(endpoint: string): string {
    return endpoint
        .trim()
        .replace(/\/+$/, '')
        .replace(/\/api\/public\/otel(\/v1\/traces)?$/, '');
}

export function userSinkTarget(sink: TelemetrySinkSettings): OtlpTarget {
    if (sink.kind === 'langfuse') {
        return {
            url: `${langfuseBaseUrl(sink.endpoint)}${LANGFUSE_OTLP_TRACES_PATH}`,
            headers: {
                ...(sink.headers ?? {}),
                Authorization: `Basic ${base64Utf8(`${sink.publicKey ?? ''}:${sink.secretKey ?? ''}`)}`,
                [LANGFUSE_INGESTION_VERSION_HEADER]: LANGFUSE_INGESTION_VERSION,
            },
        };
    }
    return { url: sink.endpoint.trim(), headers: { ...(sink.headers ?? {}) } };
}

/** The OTLP exporter needs an absolute URL; credentials are added server side by the relay. */
export function operatorRelayTarget(origin: string): OtlpTarget {
    return { url: new URL(ASSISTANT_TELEMETRY_RELAY_PATH, origin).href, headers: {} };
}

/** Every secret the browser knows at runtime, for verbatim scrubbing. */
export function collectKnownSecrets(settings: AssistantSettings): string[] {
    const secrets: string[] = [];
    for (const provider of settings.providers) {
        if (provider.apiKey) {
            secrets.push(provider.apiKey);
        }
    }
    const sink = settings.telemetry.sink;
    if (sink?.secretKey) {
        secrets.push(sink.secretKey);
    }
    if (sink?.publicKey) {
        secrets.push(sink.publicKey);
    }
    for (const value of Object.values(sink?.headers ?? {})) {
        secrets.push(value);
    }
    if (sink) {
        const target = userSinkTarget(sink);
        if (target.headers.Authorization) {
            secrets.push(target.headers.Authorization.replace(/^Basic /, ''));
        }
    }
    return secrets.filter(secret => secret.trim() !== '');
}
