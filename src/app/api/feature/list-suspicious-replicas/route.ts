import 'reflect-metadata';
import { NextRequest, NextResponse } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import { BaseController } from '@/lib/sdk/controller';
import { ListSuspiciousReplicasControllerParameters } from '@/lib/infrastructure/controller/list-suspicious-replicas-controller';
import { executeAuthenticatedController } from '@/lib/infrastructure/adapters/app-router-controller-adapter';
import { ListSuspiciousReplicasSchema } from '@/lib/infrastructure/api-schemas/list-suspicious-replicas';
import { parseQuery } from '@/lib/infrastructure/api-schemas/parse';

/**
 * GET /api/feature/list-suspicious-replicas
 * Query params (all optional): rse_expression, younger_than, nattempts (integer)
 * Returns a streamed NDJSON response of SuspiciousReplicaViewModel items.
 */
export async function GET(request: NextRequest) {
    try {
        const params = parseQuery(ListSuspiciousReplicasSchema, new URL(request.url).searchParams);

        if (!params.success) {
            return NextResponse.json({ error: 'Invalid query parameters', details: params.error.issues }, { status: 400 });
        }

        const controller = appContainer.get<BaseController<ListSuspiciousReplicasControllerParameters, void>>(CONTROLLERS.LIST_SUSPICIOUS_REPLICAS);

        return executeAuthenticatedController(
            controller,
            {
                rseExpression: params.data.rse_expression,
                youngerThan: params.data.younger_than,
                nattempts: params.data.nattempts,
            },
            true,
        );
    } catch (error) {
        console.error('Error in list-suspicious-replicas:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
