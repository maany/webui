import type { AssistantConfig, TelemetryContentLevel } from '@/lib/core/entity/assistant/assistant-config';
import type { AssistantSettings, TelemetrySinkSettings } from '@/lib/core/entity/assistant/settings';

export const CONTENT_LEVEL_ORDER: readonly TelemetryContentLevel[] = ['metadata', 'full'];

function contentRank(level: TelemetryContentLevel): number {
    const rank = CONTENT_LEVEL_ORDER.indexOf(level);
    return rank === -1 ? 0 : rank;
}

/** True when `level` does not exceed the operator cap. */
export function isContentLevelAllowed(level: TelemetryContentLevel, cap: TelemetryContentLevel): boolean {
    return CONTENT_LEVEL_ORDER.indexOf(level) !== -1 && contentRank(level) <= contentRank(cap);
}

/** min(requested, cap) by CONTENT_LEVEL_ORDER; unknown values fall back to 'metadata'. */
export function effectiveContentLevel(requested: TelemetryContentLevel, cap: TelemetryContentLevel): TelemetryContentLevel {
    return CONTENT_LEVEL_ORDER[Math.min(contentRank(requested), contentRank(cap))];
}

/** A user sink is usable when it has an endpoint and, for Langfuse, both keys. */
export function isUserSinkComplete(sink: TelemetrySinkSettings | undefined): sink is TelemetrySinkSettings {
    if (!sink || sink.endpoint.trim() === '') {
        return false;
    }
    if (sink.kind === 'langfuse') {
        return Boolean(sink.publicKey?.trim()) && Boolean(sink.secretKey?.trim());
    }
    return true;
}

export interface TelemetryPlan {
    userSink?: TelemetrySinkSettings;
    operatorSink: boolean;
    contentLevel: TelemetryContentLevel;
}

/**
 * Which sinks export, and at which content level. Applied on every render from live
 * settings and config, so a lowered operator cap or an opt-out takes effect without a reload.
 * The two sinks are independent opt-ins:
 * - user sink: the operator allows user sinks, the user enabled one and it is complete;
 * - operator sink: the operator configured one and the user chose to share with it.
 * Returns null when nothing should be exported.
 */
export function resolveTelemetryPlan(settings: AssistantSettings['telemetry'], config: AssistantConfig['telemetry']): TelemetryPlan | null {
    const userSink = config.allowUserSinks && settings.enabled && isUserSinkComplete(settings.sink) ? settings.sink : undefined;
    const operatorSink = config.operatorSink && settings.shareWithOperator === true;
    if (!userSink && !operatorSink) {
        return null;
    }
    return {
        userSink,
        operatorSink,
        contentLevel: effectiveContentLevel(settings.contentLevel, config.contentCap),
    };
}
