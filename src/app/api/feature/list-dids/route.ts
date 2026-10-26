import 'reflect-metadata';
import { NextRequest, NextResponse } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import { BaseController } from '@/lib/sdk/controller';
import { ListDIDsControllerParameters } from '@/lib/infrastructure/controller/list-dids-controller';
import { executeAuthenticatedController } from '@/lib/infrastructure/adapters/app-router-controller-adapter';
import { DIDFilter, DIDFilterOperator } from '@/lib/core/entity/rucio';
import { ListDidsSchema } from '@/lib/infrastructure/api-schemas/list-dids';
import { firstInvalidField, parseQuery } from '@/lib/infrastructure/api-schemas/parse';

/**
 * GET /api/feature/list-dids
 * Query params: query, type, filters (optional, repeatable)
 * Returns a list of DIDs matching the query and type
 */
export async function GET(request: NextRequest) {
    try {
        const params = parseQuery(ListDidsSchema, new URL(request.url).searchParams);

        if (!params.success) {
            const field = firstInvalidField(params.error);
            if (field === 'query' || field === 'type') {
                return NextResponse.json({ error: `Missing required parameter: ${field}` }, { status: 400 });
            }
            return NextResponse.json({ error: 'Invalid parameter: filters' }, { status: 400 });
        }

        // Parse DID filters
        const didfilters = parseDIDFilters(params.data.filters);

        const controller = appContainer.get<BaseController<ListDIDsControllerParameters, void>>(CONTROLLERS.LIST_DIDS);
        return executeAuthenticatedController(controller, { query: params.data.query, type: params.data.type, filters: didfilters }, true);
    } catch (error) {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

function parseDIDFilters(filters: string[] | undefined): DIDFilter[] {
    if (!filters) return [];

    return filters.map(m => {
        // Match the first valid operator
        const operatorMatch = (m.match(/(!=|>=|<=|>|<|=)/)?.[0] as DIDFilterOperator) || '=';
        const operatorIndex = m.indexOf(operatorMatch);

        return {
            key: m.substring(0, operatorIndex),
            operator: operatorMatch,
            value: m.substring(operatorIndex + operatorMatch.length),
        };
    });
}
