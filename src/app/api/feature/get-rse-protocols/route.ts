import 'reflect-metadata';
import { NextRequest, NextResponse } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import { BaseController } from '@/lib/sdk/controller';
import { GetRSEProtocolsControllerParameters } from '@/lib/infrastructure/controller/get-rse-protocols-controller';
import { executeAuthenticatedController } from '@/lib/infrastructure/adapters/app-router-controller-adapter';
import { withFeature } from '@/lib/infrastructure/adapters/with-feature';
import { GetRseProtocolsSchema } from '@/lib/infrastructure/api-schemas/get-rse-protocols';
import { parseQuery } from '@/lib/infrastructure/api-schemas/parse';

/**
 * GET /api/feature/get-rse-protocols
 * Query params: rse
 * Returns protocols configured for a specific RSE
 */
async function getHandler(request: NextRequest) {
    try {
        const params = parseQuery(GetRseProtocolsSchema, new URL(request.url).searchParams);

        if (!params.success) {
            return NextResponse.json({ error: 'Missing required parameter: rse or rseName' }, { status: 400 });
        }

        // The schema guarantees one of them is a non-empty string
        const rseName = params.data.rse || params.data.rseName || '';

        const controller = appContainer.get<BaseController<GetRSEProtocolsControllerParameters, void>>(CONTROLLERS.GET_RSE_PROTOCOLS);

        return executeAuthenticatedController(controller, { rseName });
    } catch (error) {
        console.error('Error in get-rse-protocols:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export const GET = withFeature(CONTROLLERS.GET_RSE_PROTOCOLS, getHandler);
