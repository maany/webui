import 'reflect-metadata';
import { NextRequest, NextResponse } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import { BaseController } from '@/lib/sdk/controller';
import { GetFTSLinkControllerParameters } from '@/lib/infrastructure/controller/get-fts-link-controller';
import { executeAuthenticatedController } from '@/lib/infrastructure/adapters/app-router-controller-adapter';
import { GetFtsLinkSchema } from '@/lib/infrastructure/api-schemas/get-fts-link';
import { firstInvalidField, parseQuery } from '@/lib/infrastructure/api-schemas/parse';

/**
 * GET /api/feature/get-fts-link
 * Query params: scope, name, rse
 * Returns FTS (File Transfer Service) link information
 */
export async function GET(request: NextRequest) {
    try {
        const params = parseQuery(GetFtsLinkSchema, new URL(request.url).searchParams);

        if (!params.success) {
            return NextResponse.json({ error: `Missing required parameter: ${firstInvalidField(params.error)}` }, { status: 400 });
        }

        const controller = appContainer.get<BaseController<GetFTSLinkControllerParameters, void>>(CONTROLLERS.GET_FTS_LINK);

        return executeAuthenticatedController(controller, { scope: params.data.scope, name: params.data.name, rse: params.data.rse });
    } catch (error) {
        console.error('Error in get-fts-link:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
