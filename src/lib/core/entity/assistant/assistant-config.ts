import type { ToolPolicy } from './tool';
import { BYOK_PROVIDER_KINDS, type ByokProviderKind, type ModelPricing, type OperatorProviderInfo } from './provider-config';
import type { SkillDefinition } from './skill';

export type TelemetryContentLevel = 'metadata' | 'full';

export interface AssistantConfig {
    writePolicyCap: ToolPolicy;
    highRiskPolicyCap: Exclude<ToolPolicy, 'allow'>;
    allowByok: boolean;
    allowedProviderKinds: ByokProviderKind[];
    defaultProvider?: OperatorProviderInfo;
    telemetry: { operatorSink: boolean; allowUserSinks: boolean; contentCap: TelemetryContentLevel; hashUser: boolean };
    operatorSkills: SkillDefinition[]; // source: 'operator'
    pricesOverride?: Record<string, ModelPricing>;
    /** ASSISTANT_MAX_TOOL_CALLS: tool calls one turn may make, parallel calls included. Unset means the default (20). */
    maxToolCallsPerTurn?: number;
}

export const DEFAULT_ASSISTANT_CONFIG: AssistantConfig = {
    writePolicyCap: 'ask',
    highRiskPolicyCap: 'ask',
    allowByok: true,
    allowedProviderKinds: [...BYOK_PROVIDER_KINDS],
    telemetry: { operatorSink: false, allowUserSinks: true, contentCap: 'metadata', hashUser: false },
    operatorSkills: [],
};
