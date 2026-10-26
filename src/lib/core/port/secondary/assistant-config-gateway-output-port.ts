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
}
