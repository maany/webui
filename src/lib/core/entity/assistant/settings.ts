import type { ProviderConfig } from './provider-config';
import type { ToolPolicyPrefs } from './tool';
import type { TelemetryContentLevel } from './assistant-config';

export interface UserSkill {
    name: string;
    description: string;
    body: string;
    allowedTools?: string[];
    importedAt: string; // ISO
}

export interface TelemetrySinkSettings {
    kind: 'langfuse' | 'otlp';
    endpoint: string; // langfuse: base URL (e.g. https://cloud.langfuse.com); otlp: full traces URL
    publicKey?: string;
    secretKey?: string;
    headers?: Record<string, string>;
}

export interface RetentionSettings {
    maxAgeDays: number; // default 30
    maxTotalMB: number; // default 50
    clearOnLogout: boolean; // default false
}

export interface AssistantSettings {
    version: 1;
    providers: ProviderConfig[];
    activeProviderId: string | 'operator';
    keyStorage: 'local' | 'session';
    toolPolicies: ToolPolicyPrefs;
    skills: { enabled: Record<string, boolean>; user: UserSkill[] };
    telemetry: {
        sink?: TelemetrySinkSettings;
        contentLevel: TelemetryContentLevel;
        enabled: boolean;
        /** Opt-in for the operator trace export (ASSISTANT_TELEMETRY_OTLP_ENDPOINT). Default false; settings saved without it read as false. */
        shareWithOperator: boolean;
    };
    display: { detail: 'compact' | 'verbose' };
    retention: RetentionSettings;
}
