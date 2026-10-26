import 'reflect-metadata';
import { NextRequest, NextResponse } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import { BaseController } from '@/lib/sdk/controller';
import { GetRuleControllerParameters } from '@/lib/infrastructure/controller/get-rule-controller';
import { executeAuthenticatedController } from '@/lib/infrastructure/adapters/app-router-controller-adapter';
import { withFeature } from '@/lib/infrastructure/adapters/with-feature';
import { GetRuleSchema } from '@/lib/infrastructure/api-schemas/get-rule';
import { parseQuery } from '@/lib/infrastructure/api-schemas/parse';

/**
 * GET /api/feature/get-rule
 * Query params: id
 * Returns detailed information about a specific rule
 */
async function getHandler(request: NextRequest) {
    try {
        const params = parseQuery(GetRuleSchema, new URL(request.url).searchParams);

        if (!params.success) {
            return NextResponse.json({ error: 'Missing required parameter: id' }, { status: 400 });
        }

        const controller = appContainer.get<BaseController<GetRuleControllerParameters, void>>(CONTROLLERS.GET_RULE);

        return executeAuthenticatedController(controller, { id: params.data.id });
    } catch (error) {
        console.error('Error in get-rule:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export const GET = withFeature(CONTROLLERS.GET_RULE, getHandler);
