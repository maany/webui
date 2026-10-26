import 'reflect-metadata';
import { NextRequest } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import GATEWAYS from '@/lib/infrastructure/ioc/ioc-symbols-gateway';
import type FeatureConfigGatewayOutputPort from '@/lib/core/port/secondary/feature-config-gateway-output-port';
import type AssistantConfigGatewayOutputPort from '@/lib/core/port/secondary/assistant-config-gateway-output-port';
import { getSessionUser } from '@/lib/infrastructure/auth/nextauth-session-utils';
import { relayTelemetry, telemetryRelayRateLimiter } from '@/lib/infrastructure/assistant/telemetry-relay';

/**
 * POST /api/assistant/telemetry
 * Body: OTLP/HTTP JSON trace export from the browser (only when the user opted in to sharing).
 * Forwards to ASSISTANT_TELEMETRY_OTLP_ENDPOINT with ASSISTANT_TELEMETRY_OTLP_HEADERS, hashing user ids when asked.
 */
export async function POST(request: NextRequest) {
    const assistantConfig = appContainer.get<AssistantConfigGatewayOutputPort>(GATEWAYS.ASSISTANT_CONFIG);
    return relayTelemetry(request, {
        assistantEnabled: () => appContainer.get<FeatureConfigGatewayOutputPort>(GATEWAYS.FEATURE_CONFIG).isEnabled('assistant'),
        session: async () => {
            const user = await getSessionUser();
            if (!user || !user.isLoggedIn) {
                return undefined;
            }
            const accountKey = `${user.rucioAccount}@${user.rucioVO}`;
            return { rateLimitKey: `${user.rucioIdentity}|${accountKey}`, accountKey };
        },
        upstream: async () => (assistantConfig.getTelemetryRelayConfig ? assistantConfig.getTelemetryRelayConfig() : undefined),
        rateLimit: async (rateLimitKey, limitPerMinute) => telemetryRelayRateLimiter.hit(rateLimitKey, limitPerMinute),
        fetchImpl: (input, init) => fetch(input, init),
    });
}
