import type { AssistantConfig } from '@/lib/core/entity/assistant/assistant-config';
import type { OperatorProviderInfo } from '@/lib/core/entity/assistant/provider-config';

/**
 * Server-only settings for the operator LLM relay.
 * Contains the operator API key: never send this object to a browser.
 */
export interface AssistantRelayConfig {
    kind: OperatorProviderInfo['kind'];
    /** ASSISTANT_DEFAULT_BASE_URL without trailing slashes */
    baseURL: string;
    apiKey?: string;
    rateLimitPerMinute: number;
    /** ASSISTANT_LLM_UPSTREAM_TIMEOUT_MS: time to upstream headers and max idle gap in the response body (default 120000) */
    upstreamTimeoutMs: number;
    /** ASSISTANT_LLM_UPSTREAM_MAX_MS: total deadline for one relayed request, headers plus body (default 600000) */
    upstreamMaxMs: number;
}

/**
 * Server-only operator telemetry sink for POST /api/assistant/telemetry.
 * Contains the OTLP headers and the user salt (credentials): never send this object to a browser.
 */
export interface AssistantTelemetryRelayConfig {
    /** ASSISTANT_TELEMETRY_OTLP_ENDPOINT without trailing slashes */
    endpoint: string;
    /** ASSISTANT_TELEMETRY_OTLP_HEADERS parsed from `k=v,k2=v2` */
    headers: Record<string, string>;
    /** ASSISTANT_RELAY_RATE_LIMIT, parsed like the LLM relay limit */
    rateLimitPerMinute: number;
    /** ASSISTANT_TELEMETRY_HASH_USER */
    hashUser: boolean;
    /** getTelemetryUserSalt(); always set when hashUser is true */
    userSalt?: string;
}

export default interface AssistantConfigGatewayOutputPort {
    /** Operator configuration that is safe to send to the browser. Never throws: invalid values fall back to defaults. */
    getAssistantConfig(): Promise<AssistantConfig>;
    /** Relay upstream, or undefined when no complete operator default model is configured. */
    getRelayConfig(): Promise<AssistantRelayConfig | undefined>;
    /**
     * Server-only deployment secret (ASSISTANT_TELEMETRY_USER_SALT) for hashing user ids in operator traces,
     * or undefined when it is missing or shorter than 16 characters. Never send it to a browser.
     * Separate from getRelayConfig(), which is undefined whenever no operator model is configured.
     */
    getTelemetryUserSalt(): Promise<string | undefined>;
    /**
     * Operator OTLP sink for the telemetry relay (phase 6), or undefined when ASSISTANT_TELEMETRY_OTLP_ENDPOINT
     * is not a valid http(s) URL or hashUser is on without a valid salt (the cases where operatorSink is false).
     */
    getTelemetryRelayConfig?(): Promise<AssistantTelemetryRelayConfig | undefined>;
}
