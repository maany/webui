import 'reflect-metadata';
import { NextRequest, NextResponse } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import { BaseController } from '@/lib/sdk/controller';
import { UpdateAccountAttributeControllerParameters } from '@/lib/infrastructure/controller/update-account-attribute-controller';
import { executeAuthenticatedController, parseRequestBody } from '@/lib/infrastructure/adapters/app-router-controller-adapter';
import { withFeature } from '@/lib/infrastructure/adapters/with-feature';
import { withAdmin } from '@/lib/infrastructure/adapters/with-admin';
import { UpdateAccountAttributeSchema } from '@/lib/infrastructure/api-schemas/update-account-attribute';

/**
 * PUT /api/feature/update-account-attribute
 * Body: { account, key, value }
 * Admin only.
 */
async function handler(request: NextRequest) {
    const body = await parseRequestBody(request);
    const params = UpdateAccountAttributeSchema.safeParse(body);
    if (!params.success) {
        return NextResponse.json(
            { status: 'error', errorType: 'validation_error', message: params.error.issues[0]?.message ?? 'Invalid request' },
            { status: 400 },
        );
    }
    const controller = appContainer.get<BaseController<UpdateAccountAttributeControllerParameters, void>>(CONTROLLERS.UPDATE_ACCOUNT_ATTRIBUTE);
    return executeAuthenticatedController(controller, params.data);
}

export const PUT = withFeature(CONTROLLERS.UPDATE_ACCOUNT_ATTRIBUTE, withAdmin(handler));
