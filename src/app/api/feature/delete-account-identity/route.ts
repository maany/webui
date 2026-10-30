import 'reflect-metadata';
import { NextRequest, NextResponse } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import { BaseController } from '@/lib/sdk/controller';
import { DeleteAccountIdentityControllerParameters } from '@/lib/infrastructure/controller/delete-account-identity-controller';
import { executeAuthenticatedController, parseRequestBody } from '@/lib/infrastructure/adapters/app-router-controller-adapter';
import { withFeature } from '@/lib/infrastructure/adapters/with-feature';
import { withAdmin } from '@/lib/infrastructure/adapters/with-admin';
import { IdentityType } from '@/lib/core/entity/account';
import { DeleteAccountIdentitySchema } from '@/lib/infrastructure/api-schemas/delete-account-identity';

/**
 * DELETE /api/feature/delete-account-identity
 * Body: { account, identity, authType }
 * Admin only.
 */
async function handler(request: NextRequest) {
    const body = await parseRequestBody(request);
    const params = DeleteAccountIdentitySchema.safeParse(body);
    if (!params.success) {
        return NextResponse.json(
            { status: 'error', errorType: 'validation_error', message: params.error.issues[0]?.message ?? 'Invalid request' },
            { status: 400 },
        );
    }
    const controller = appContainer.get<BaseController<DeleteAccountIdentityControllerParameters, void>>(CONTROLLERS.DELETE_ACCOUNT_IDENTITY);
    return executeAuthenticatedController(controller, { ...params.data, authType: params.data.authType as IdentityType });
}

export const DELETE = withFeature(CONTROLLERS.DELETE_ACCOUNT_IDENTITY, withAdmin(handler));
