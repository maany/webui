import 'reflect-metadata';
import { NextRequest, NextResponse } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import { BaseController } from '@/lib/sdk/controller';
import { SetAccountLimitControllerParameters } from '@/lib/infrastructure/controller/set-account-limit-controller';
import { executeAuthenticatedController, parseRequestBody } from '@/lib/infrastructure/adapters/app-router-controller-adapter';
import { withFeature } from '@/lib/infrastructure/adapters/with-feature';
import { withAdmin } from '@/lib/infrastructure/adapters/with-admin';
import { SetAccountLimitSchema } from '@/lib/infrastructure/api-schemas/set-account-limit';

/**
 * PUT /api/feature/set-account-limit
 * Body: { account, locality, rseExpression, bytes }  (bytes -1 means unlimited)
 * Admin only.
 */
async function handler(request: NextRequest) {
    const body = await parseRequestBody(request);
    const params = SetAccountLimitSchema.safeParse(body);
    if (!params.success) {
        return NextResponse.json(
            { status: 'error', errorType: 'validation_error', message: params.error.issues[0]?.message ?? 'Invalid request' },
            { status: 400 },
        );
    }
    const controller = appContainer.get<BaseController<SetAccountLimitControllerParameters, void>>(CONTROLLERS.SET_ACCOUNT_LIMIT);
    return executeAuthenticatedController(controller, params.data);
}

export const PUT = withFeature(CONTROLLERS.SET_ACCOUNT_LIMIT, withAdmin(handler));
