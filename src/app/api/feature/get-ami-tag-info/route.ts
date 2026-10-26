import 'reflect-metadata';
import { NextRequest, NextResponse } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import { BaseController } from '@/lib/sdk/controller';
import { GetAMITagInfoControllerParameters } from '@/lib/infrastructure/controller/get-ami-tag-info-controller';
import { executeAuthenticatedController } from '@/lib/infrastructure/adapters/app-router-controller-adapter';
import { withFeature } from '@/lib/infrastructure/adapters/with-feature';
import { GetAmiTagInfoSchema } from '@/lib/infrastructure/api-schemas/get-ami-tag-info';
import { parseQuery } from '@/lib/infrastructure/api-schemas/parse';

/**
 * GET /api/feature/get-ami-tag-info
 * Query params: tags (comma-separated AMI tags, e.g. f1723,m2281)
 * Returns AMI links and best-effort AMI details for each tag (ATLAS only, dids.ami_tags)
 */
async function getHandler(request: NextRequest) {
    try {
        const params = parseQuery(GetAmiTagInfoSchema, new URL(request.url).searchParams);
        if (!params.success) {
            return NextResponse.json({ error: params.error.issues[0].message }, { status: 400 });
        }

        // The feature is only loaded when the flag was on at startup; if it was
        // switched on later without a restart, answer like a disabled feature.
        if (!appContainer.isBound(CONTROLLERS.GET_AMI_TAG_INFO)) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const controller = appContainer.get<BaseController<GetAMITagInfoControllerParameters, void>>(CONTROLLERS.GET_AMI_TAG_INFO);

        return executeAuthenticatedController(controller, { tags: params.data.tags });
    } catch (error) {
        console.error('Error in get-ami-tag-info:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export const GET = withFeature(CONTROLLERS.GET_AMI_TAG_INFO, getHandler);
