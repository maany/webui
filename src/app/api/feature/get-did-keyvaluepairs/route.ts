import 'reflect-metadata';
import { NextRequest, NextResponse } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import { BaseController } from '@/lib/sdk/controller';
import { DIDKeyValuePairsDataControllerParameters } from '@/lib/infrastructure/controller/did-keyvaluepairs-controller';
import { executeAuthenticatedController } from '@/lib/infrastructure/adapters/app-router-controller-adapter';
import { withFeature } from '@/lib/infrastructure/adapters/with-feature';
import { GetDidKeyvaluepairsSchema } from '@/lib/infrastructure/api-schemas/get-did-keyvaluepairs';
import { parseQuery } from '@/lib/infrastructure/api-schemas/parse';

/**
 * GET /api/feature/get-did-keyvaluepairs
 * Query params: scope, name
 * Returns key-value pairs (metadata attributes) for a specific DID
 */
async function getHandler(request: NextRequest) {
    try {
        const params = parseQuery(GetDidKeyvaluepairsSchema, new URL(request.url).searchParams);

        if (!params.success) {
            return NextResponse.json({ error: 'Missing required parameters: scope and name' }, { status: 400 });
        }

        const controller = appContainer.get<BaseController<DIDKeyValuePairsDataControllerParameters, void>>(CONTROLLERS.DID_KEYVALUEPAIRS);

        return executeAuthenticatedController(controller, { scope: params.data.scope, name: params.data.name });
    } catch (error) {
        console.error('Error in get-did-keyvaluepairs:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export const GET = withFeature(CONTROLLERS.DID_KEYVALUEPAIRS, getHandler);
