import 'reflect-metadata';
import { NextRequest, NextResponse } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import { BaseController } from '@/lib/sdk/controller';
import { GetDDMLinkControllerParameters } from '@/lib/infrastructure/controller/get-ddm-link-controller';
import { executeAuthenticatedController } from '@/lib/infrastructure/adapters/app-router-controller-adapter';
import { GetDdmLinkSchema } from '@/lib/infrastructure/api-schemas/get-ddm-link';
import { firstInvalidField, parseQuery } from '@/lib/infrastructure/api-schemas/parse';

/**
 * GET /api/feature/get-ddm-link
 * Query params: scope, name, rse
 * Returns DDM Dashboard link for the given scope, name, and RSE
 */
export async function GET(request: NextRequest) {
    try {
        const params = parseQuery(GetDdmLinkSchema, new URL(request.url).searchParams);

        if (!params.success) {
            return NextResponse.json({ error: `Missing required parameter: ${firstInvalidField(params.error)}` }, { status: 400 });
        }

        const controller = appContainer.get<BaseController<GetDDMLinkControllerParameters, void>>(CONTROLLERS.GET_DDM_LINK);

        return executeAuthenticatedController(controller, { scope: params.data.scope, name: params.data.name, rse: params.data.rse });
    } catch (error) {
        console.error('Error in get-ddm-link:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
