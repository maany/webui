import 'reflect-metadata';
import { NextRequest, NextResponse } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import { BaseController } from '@/lib/sdk/controller';
import { CreateAccountControllerParameters } from '@/lib/infrastructure/controller/create-account-controller';
import { executeAuthenticatedController, parseRequestBody } from '@/lib/infrastructure/adapters/app-router-controller-adapter';
import { withFeature } from '@/lib/infrastructure/adapters/with-feature';
import { withAdmin } from '@/lib/infrastructure/adapters/with-admin';
import { AccountType } from '@/lib/core/entity/rucio';
import { CreateAccountSchema } from '@/lib/infrastructure/api-schemas/create-account';

/**
 * POST /api/feature/create-account
 * Body: { account, accountType, email | null }
 * Admin only. Rucio itself restricts account creation to the root account.
 */
async function postHandler(request: NextRequest) {
    const body = await parseRequestBody(request);
    const params = CreateAccountSchema.safeParse(body);
    if (!params.success) {
        return NextResponse.json(
            { status: 'error', errorType: 'validation_error', message: params.error.issues[0]?.message ?? 'Invalid request' },
            { status: 400 },
        );
    }
    const controller = appContainer.get<BaseController<CreateAccountControllerParameters, void>>(CONTROLLERS.CREATE_ACCOUNT);
    return executeAuthenticatedController(controller, { ...params.data, accountType: params.data.accountType as AccountType });
}

export const POST = withFeature(CONTROLLERS.CREATE_ACCOUNT, withAdmin(postHandler));
