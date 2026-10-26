import 'reflect-metadata';
import { NextRequest, NextResponse } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import { BaseController } from '@/lib/sdk/controller';
import { ListRulesPendingApprovalControllerParameters } from '@/lib/infrastructure/controller/list-rules-pending-approval-controller';
import { ListRulesPendingApprovalRequest } from '@/lib/core/usecase-models/list-rules-pending-approval-usecase-models';
import { executeAuthenticatedController } from '@/lib/infrastructure/adapters/app-router-controller-adapter';
import { getSessionUser } from '@/lib/infrastructure/auth/nextauth-session-utils';
import { withFeature } from '@/lib/infrastructure/adapters/with-feature';
import { ListRulesPendingApprovalSchema } from '@/lib/infrastructure/api-schemas/list-rules-pending-approval';
import { parseQuery } from '@/lib/infrastructure/api-schemas/parse';

/**
 * GET /api/feature/list-rules-pending-approval
 * Query params: scope, name, updated_after, updated_before, account, activity
 * Returns a list of rules pending approval with extended metadata and DID enrichment.
 */
async function getHandler(request: NextRequest) {
    try {
        const sessionUser = await getSessionUser();

        if (!sessionUser) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const validationResult = parseQuery(ListRulesPendingApprovalSchema, new URL(request.url).searchParams);
        if (!validationResult.success) {
            return NextResponse.json(
                {
                    error: 'Invalid query parameters',
                    details: validationResult.error.issues,
                },
                { status: 400 },
            );
        }

        const filters = validationResult.data;

        const controller = appContainer.get<BaseController<ListRulesPendingApprovalControllerParameters, ListRulesPendingApprovalRequest>>(
            CONTROLLERS.LIST_RULES_PENDING_APPROVAL,
        );

        return executeAuthenticatedController(
            controller,
            {
                filters: {
                    ...filters,
                    updated_after: filters.updated_after ? new Date(filters.updated_after) : undefined,
                    updated_before: filters.updated_before ? new Date(filters.updated_before) : undefined,
                },
            },
            true, // streaming endpoint
        );
    } catch (error) {
        console.error('Error in list-rules-pending-approval:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export const GET = withFeature(CONTROLLERS.LIST_RULES_PENDING_APPROVAL, getHandler);
