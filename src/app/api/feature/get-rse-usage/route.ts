import 'reflect-metadata';
import { NextRequest, NextResponse } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import { BaseController } from '@/lib/sdk/controller';
import { GetRSEUsageControllerParameters } from '@/lib/infrastructure/controller/get-rse-usage-controller';
import { executeAuthenticatedController } from '@/lib/infrastructure/adapters/app-router-controller-adapter';
import { withFeature } from '@/lib/infrastructure/adapters/with-feature';
import { GetRseUsageSchema } from '@/lib/infrastructure/api-schemas/get-rse-usage';
import { parseQuery } from '@/lib/infrastructure/api-schemas/parse';

/**
 * GET /api/feature/get-rse-usage
 * Query params: rse
 * Returns storage usage information for a specific RSE
 */
async function getHandler(request: NextRequest) {
    try {
        const params = parseQuery(GetRseUsageSchema, new URL(request.url).searchParams);

        if (!params.success) {
            return NextResponse.json({ error: 'Missing required parameter: rse or rseName' }, { status: 400 });
        }

        // The schema guarantees one of them is a non-empty string
        const rseName = params.data.rse || params.data.rseName || '';

        const controller = appContainer.get<BaseController<GetRSEUsageControllerParameters, void>>(CONTROLLERS.GET_RSE_USAGE);

        return executeAuthenticatedController(controller, { rseName });
    } catch (error) {
        console.error('Error in get-rse-usage:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export const GET = withFeature(CONTROLLERS.GET_RSE_USAGE, getHandler);
