import 'reflect-metadata';
import { NextRequest, NextResponse } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import { BaseController } from '@/lib/sdk/controller';
import { UpdateAccountControllerParameters } from '@/lib/infrastructure/controller/update-account-controller';
import { executeAuthenticatedController, parseRequestBody } from '@/lib/infrastructure/adapters/app-router-controller-adapter';
import { withFeature } from '@/lib/infrastructure/adapters/with-feature';
import { withAdmin } from '@/lib/infrastructure/adapters/with-admin';
import { AccountUpdateOptions } from '@/lib/core/entity/account';
import { UpdateAccountSchema } from '@/lib/infrastructure/api-schemas/update-account';

/**
 * PUT /api/feature/update-account
 * Body: { account, options: { email?, status?, accountType? } }
 * Admin only. Changes the email, type or status (suspend / reactivate) of an account.
 */
async function putHandler(request: NextRequest) {
    const body = await parseRequestBody(request);
    const params = UpdateAccountSchema.safeParse(body);
    if (!params.success) {
        return NextResponse.json(
            { status: 'error', errorType: 'validation_error', message: params.error.issues[0]?.message ?? 'Invalid request' },
            { status: 400 },
        );
    }
    const controller = appContainer.get<BaseController<UpdateAccountControllerParameters, void>>(CONTROLLERS.UPDATE_ACCOUNT);
    return executeAuthenticatedController(controller, { account: params.data.account, options: params.data.options as AccountUpdateOptions });
}

export const PUT = withFeature(CONTROLLERS.UPDATE_ACCOUNT, withAdmin(putHandler));
