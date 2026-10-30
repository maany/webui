import 'reflect-metadata';
import { NextRequest, NextResponse } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import { BaseController } from '@/lib/sdk/controller';
import { ListAccountsControllerParameters } from '@/lib/infrastructure/controller/list-accounts-controller';
import { executeAuthenticatedController } from '@/lib/infrastructure/adapters/app-router-controller-adapter';
import { withFeature } from '@/lib/infrastructure/adapters/with-feature';
import { withAdmin } from '@/lib/infrastructure/adapters/with-admin';
import { AccountListFilter } from '@/lib/core/entity/account';
import { ListAccountsSchema } from '@/lib/infrastructure/api-schemas/list-accounts';
import { parseQuery } from '@/lib/infrastructure/api-schemas/parse';

/**
 * GET /api/feature/list-accounts
 * Query params: account (name pattern, optional), accountType (USER | GROUP | SERVICE, optional), identity (optional)
 * Streams the accounts matching the filter. Admins only.
 */
async function getHandler(request: NextRequest) {
    const params = parseQuery(ListAccountsSchema, request.nextUrl.searchParams);
    if (!params.success) {
        return NextResponse.json({ status: 'error', errorType: 'validation_error', message: 'Invalid account filter' }, { status: 400 });
    }
    const filter: AccountListFilter = {};
    if (params.data.account !== undefined) filter.account = params.data.account;
    if (params.data.accountType !== undefined) filter.accountType = params.data.accountType;
    if (params.data.identity !== undefined) filter.identity = params.data.identity;

    const controller = appContainer.get<BaseController<ListAccountsControllerParameters, void>>(CONTROLLERS.LIST_ACCOUNTS);
    return executeAuthenticatedController(controller, { filter }, true);
}

export const GET = withFeature(CONTROLLERS.LIST_ACCOUNTS, withAdmin(getHandler));
