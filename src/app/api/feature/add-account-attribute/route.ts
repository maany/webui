import 'reflect-metadata';
import { NextRequest, NextResponse } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import { BaseController } from '@/lib/sdk/controller';
import { AddAccountAttributeControllerParameters } from '@/lib/infrastructure/controller/add-account-attribute-controller';
import { executeAuthenticatedController, parseRequestBody } from '@/lib/infrastructure/adapters/app-router-controller-adapter';
import { withFeature } from '@/lib/infrastructure/adapters/with-feature';
import { withAdmin } from '@/lib/infrastructure/adapters/with-admin';
import { AddAccountAttributeSchema } from '@/lib/infrastructure/api-schemas/add-account-attribute';

/**
 * POST /api/feature/add-account-attribute
 * Body: { account, key, value }
 * Admin only.
 */
async function handler(request: NextRequest) {
    const body = await parseRequestBody(request);
    const params = AddAccountAttributeSchema.safeParse(body);
    if (!params.success) {
        return NextResponse.json(
            { status: 'error', errorType: 'validation_error', message: params.error.issues[0]?.message ?? 'Invalid request' },
            { status: 400 },
        );
    }
    const controller = appContainer.get<BaseController<AddAccountAttributeControllerParameters, void>>(CONTROLLERS.ADD_ACCOUNT_ATTRIBUTE);
    return executeAuthenticatedController(controller, params.data);
}

export const POST = withFeature(CONTROLLERS.ADD_ACCOUNT_ATTRIBUTE, withAdmin(handler));
