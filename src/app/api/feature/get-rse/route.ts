import 'reflect-metadata';
import { NextRequest, NextResponse } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import { BaseController } from '@/lib/sdk/controller';
import { GetRSEControllerParameters } from '@/lib/infrastructure/controller/get-rse-controller';
import { executeAuthenticatedController } from '@/lib/infrastructure/adapters/app-router-controller-adapter';
import { withFeature } from '@/lib/infrastructure/adapters/with-feature';
import { GetRseSchema } from '@/lib/infrastructure/api-schemas/get-rse';
import { parseQuery } from '@/lib/infrastructure/api-schemas/parse';

/**
 * GET /api/feature/get-rse
 * Query params: rseName
 * Returns information about a specific Rucio Storage Element (RSE)
 */
async function getHandler(request: NextRequest) {
    try {
        const params = parseQuery(GetRseSchema, new URL(request.url).searchParams);

        if (!params.success) {
            return NextResponse.json({ error: 'Missing required parameter: rseName' }, { status: 400 });
        }

        const controller = appContainer.get<BaseController<GetRSEControllerParameters, void>>(CONTROLLERS.GET_RSE);

        return executeAuthenticatedController(controller, { rseName: params.data.rseName });
    } catch (error) {
        console.error('Error in get-rse:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export const GET = withFeature(CONTROLLERS.GET_RSE, getHandler);
