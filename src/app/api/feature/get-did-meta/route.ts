import 'reflect-metadata';
import { NextRequest, NextResponse } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import { BaseController } from '@/lib/sdk/controller';
import { DIDMetaControllerParameters } from '@/lib/infrastructure/controller/did-meta-controller';
import { executeAuthenticatedController } from '@/lib/infrastructure/adapters/app-router-controller-adapter';
import { GetDidMetaSchema } from '@/lib/infrastructure/api-schemas/get-did-meta';
import { parseQuery } from '@/lib/infrastructure/api-schemas/parse';

/**
 * GET /api/feature/get-did-meta
 * Query params: scope, name
 * Returns metadata for a specific DID (Data Identifier)
 */
export async function GET(request: NextRequest) {
    try {
        const params = parseQuery(GetDidMetaSchema, new URL(request.url).searchParams);

        if (!params.success) {
            return NextResponse.json({ error: 'Missing required parameters: scope and name' }, { status: 400 });
        }

        const controller = appContainer.get<BaseController<DIDMetaControllerParameters, void>>(CONTROLLERS.DID_META);

        return executeAuthenticatedController(controller, { scope: params.data.scope, name: params.data.name });
    } catch (error) {
        console.error('Error in get-did-meta:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
