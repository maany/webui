import 'reflect-metadata';
import { NextRequest, NextResponse } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import { BaseController } from '@/lib/sdk/controller';
import { ListAccountAttributesControllerParameters } from '@/lib/infrastructure/controller/list-account-attributes-controller';
import { executeAuthenticatedController } from '@/lib/infrastructure/adapters/app-router-controller-adapter';
import { withFeature } from '@/lib/infrastructure/adapters/with-feature';
import { withAccountReadAccess } from '@/lib/infrastructure/adapters/with-admin';
import { ListAccountAttributesSchema } from '@/lib/infrastructure/api-schemas/list-account-attributes';
import { parseQuery } from '@/lib/infrastructure/api-schemas/parse';

/**
 * GET /api/feature/list-account-attributes?account=<name>
 * Admins may read any account; other users only their own (enforced by withAccountReadAccess).
 */
async function getHandler(request: NextRequest) {
    const params = parseQuery(ListAccountAttributesSchema, request.nextUrl.searchParams);
    if (!params.success) {
        return NextResponse.json({ status: 'error', errorType: 'validation_error', message: 'Invalid account name' }, { status: 400 });
    }
    const controller = appContainer.get<BaseController<ListAccountAttributesControllerParameters, void>>(CONTROLLERS.LIST_ACCOUNT_ATTRIBUTES);
    return executeAuthenticatedController(controller, { account: params.data.account });
}

export const GET = withFeature(CONTROLLERS.LIST_ACCOUNT_ATTRIBUTES, withAccountReadAccess(getHandler));
