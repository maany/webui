import 'reflect-metadata';
import { NextResponse } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import { BaseController } from '@/lib/sdk/controller';
import { GetAssistantConfigControllerParameters } from '@/lib/infrastructure/controller/get-assistant-config-controller';
import { executeAuthenticatedController } from '@/lib/infrastructure/adapters/app-router-controller-adapter';
import { withFeature } from '@/lib/infrastructure/adapters/with-feature';

/**
 * GET /api/feature/get-assistant-config
 * Operator configuration for Rucio bot (policy caps, BYOK rules, operator default model, telemetry caps).
 * Never contains API keys, base URLs or telemetry credentials.
 */
async function getHandler() {
    try {
        const controller = appContainer.get<BaseController<GetAssistantConfigControllerParameters, void>>(CONTROLLERS.GET_ASSISTANT_CONFIG);
        return executeAuthenticatedController(controller, {});
    } catch (error) {
        console.error('Error in get-assistant-config:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export const GET = withFeature(CONTROLLERS.GET_ASSISTANT_CONFIG, getHandler);
