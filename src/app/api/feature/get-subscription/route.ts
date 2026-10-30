import 'reflect-metadata';
import { NextRequest, NextResponse } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import GetSubscriptionController from '@/lib/infrastructure/controller/get-subscription-controller';
import { executeAuthenticatedController } from '@/lib/infrastructure/adapters/app-router-controller-adapter';
import { getSessionUser } from '@/lib/infrastructure/auth/nextauth-session-utils';
import { withFeature } from '@/lib/infrastructure/adapters/with-feature';
import { GetSubscriptionSchema } from '@/lib/infrastructure/api-schemas/get-subscription';
import { firstInvalidField, parseQuery } from '@/lib/infrastructure/api-schemas/parse';

/**
 * GET /api/feature/get-subscription
 * Query params: account, name
 * Returns details of a specific subscription
 */
async function getHandler(request: NextRequest) {
    try {
        const sessionUser = await getSessionUser();

        if (!sessionUser) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!sessionUser.rucioAccount) {
            return NextResponse.json({ error: 'Unauthorized: Rucio Account is not set' }, { status: 401 });
        }

        const params = parseQuery(GetSubscriptionSchema, new URL(request.url).searchParams);

        if (!params.success) {
            return NextResponse.json({ error: `Missing required parameter: ${firstInvalidField(params.error)}` }, { status: 400 });
        }

        const controller: GetSubscriptionController = appContainer.get(CONTROLLERS.GET_SUBSCRIPTION);

        return executeAuthenticatedController(controller, {
            name: params.data.name,
            sessionAccount: sessionUser.rucioAccount,
        });
    } catch (error) {
        console.error('Error in get-subscription:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export const GET = withFeature(CONTROLLERS.GET_SUBSCRIPTION, getHandler);
