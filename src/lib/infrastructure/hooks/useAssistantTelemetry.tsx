'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { AssistantConfig, TelemetryContentLevel } from '@/lib/core/entity/assistant/assistant-config';
import type { AssistantSettings } from '@/lib/core/entity/assistant/settings';
import type { AssistantEvent, AssistantEventListener } from '@/lib/core/entity/assistant/events';
import { resolveTelemetryPlan } from '@/lib/core/services/assistant-telemetry';
import { collectKnownSecrets, operatorRelayTarget, userSinkTarget, type OtlpTarget } from '@/lib/infrastructure/assistant/telemetry-sinks';
import type { AssistantTelemetry } from '@/lib/infrastructure/assistant/telemetry';
import { getTool } from '@/lib/infrastructure/assistant/tool-registry';

/** Events kept while the telemetry chunk loads; later ones are dropped. */
export const TELEMETRY_PENDING_EVENT_LIMIT = 500;

/** Telemetry must never break the assistant: a failing event is dropped. */
function safeHandle(telemetry: AssistantTelemetry, event: AssistantEvent): void {
    try {
        telemetry.handle(event);
    } catch {
        // dropped
    }
}

export interface UseAssistantTelemetryInput {
    /** Operator telemetry config, or undefined while the config is loading. */
    config: AssistantConfig['telemetry'] | undefined;
    settings: AssistantSettings;
    /** `${account}@${vo}` of the signed-in account, if any. */
    accountKey: string | undefined;
}

interface Targets {
    userSink?: OtlpTarget;
    operatorSink?: OtlpTarget;
}

/**
 * Starts and stops OpenTelemetry export from live config and settings and returns a stable
 * event listener for the assistant event bus. The OpenTelemetry SDK is only imported when at
 * least one sink is active. Content level, secrets and user id are read per event, so changing
 * them never restarts the exporters; changing a sink does.
 */
export function useAssistantTelemetry({ config, settings, accountKey }: UseAssistantTelemetryInput): AssistantEventListener {
    const plan = config ? resolveTelemetryPlan(settings.telemetry, config) : null;
    const targets: Targets | null = plan
        ? {
              userSink: plan.userSink ? userSinkTarget(plan.userSink) : undefined,
              operatorSink: plan.operatorSink && typeof window !== 'undefined' ? operatorRelayTarget(window.location.origin) : undefined,
          }
        : null;
    const targetsKey = targets && (targets.userSink || targets.operatorSink) ? JSON.stringify(targets) : null;

    const targetsRef = useRef<Targets | null>(targets);
    targetsRef.current = targets;
    const contentLevelRef = useRef<TelemetryContentLevel>(plan?.contentLevel ?? 'metadata');
    contentLevelRef.current = plan?.contentLevel ?? 'metadata';
    const secretsRef = useRef<string[]>([]);
    secretsRef.current = collectKnownSecrets(settings);
    // account@vo as is: the user's own sink gets their own data, and the operator relay
    // replaces it with a salted HMAC on the server when the operator asks for hashing.
    const userIdRef = useRef<string | undefined>(accountKey);
    userIdRef.current = accountKey;

    const telemetryRef = useRef<AssistantTelemetry | null>(null);
    const pendingRef = useRef<AssistantEvent[] | null>(null);

    useEffect(() => {
        if (!targetsKey) {
            // Sink removed or user opted out: whatever was queued must not reach a later sink.
            pendingRef.current = null;
            return;
        }
        let cancelled = false;
        // A fresh queue per sink set: events produced before a sink was added (for example before the
        // user opted in to the operator sink) must never be replayed to it.
        pendingRef.current = [];
        const current = targetsRef.current ?? {};
        import('@/lib/infrastructure/assistant/telemetry')
            .then(({ startAssistantTelemetry }) => {
                if (cancelled) {
                    return;
                }
                let telemetry: AssistantTelemetry;
                try {
                    telemetry = startAssistantTelemetry({
                        userSink: current.userSink,
                        operatorSink: current.operatorSink,
                        contentLevel: () => contentLevelRef.current,
                        identity: { userId: () => userIdRef.current },
                        secrets: () => secretsRef.current,
                        sensitiveArgs: toolName => getTool(toolName)?.spec.sensitiveArgs ?? [],
                    });
                } catch {
                    pendingRef.current = null;
                    return;
                }
                telemetryRef.current = telemetry;
                const queued = pendingRef.current ?? [];
                pendingRef.current = null;
                queued.forEach(event => safeHandle(telemetry, event));
            })
            .catch(() => {
                // A stale effect must not clear the queue of the one that replaced it.
                if (!cancelled) {
                    pendingRef.current = null;
                }
            });
        return () => {
            cancelled = true;
            const telemetry = telemetryRef.current;
            telemetryRef.current = null;
            telemetry?.shutdown().catch(() => undefined);
        };
    }, [targetsKey]);

    // Account switch: spans and queued events of the previous account must not be stamped with, or sent
    // under, the new one. Open spans end now (each keeps the account it started under) and the queue is dropped.
    const previousAccountRef = useRef<string | undefined>(accountKey);
    useEffect(() => {
        if (previousAccountRef.current === accountKey) {
            return;
        }
        previousAccountRef.current = accountKey;
        if (pendingRef.current) {
            pendingRef.current = [];
        }
        const telemetry = telemetryRef.current;
        if (telemetry) {
            try {
                telemetry.endAll();
            } catch {
                // Telemetry must never break the assistant.
            }
        }
    }, [accountKey]);

    return useCallback((event: AssistantEvent) => {
        const telemetry = telemetryRef.current;
        if (telemetry) {
            safeHandle(telemetry, event);
            return;
        }
        const pending = pendingRef.current;
        if (pending && pending.length < TELEMETRY_PENDING_EVENT_LIMIT) {
            pending.push(event);
        }
    }, []);
}
