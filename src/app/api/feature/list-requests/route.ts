import 'reflect-metadata';
import { NextRequest, NextResponse } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import { BaseController } from '@/lib/sdk/controller';
import { ListRequestsControllerParameters } from '@/lib/infrastructure/controller/list-requests-controller';
import { executeAuthenticatedController } from '@/lib/infrastructure/adapters/app-router-controller-adapter';
import { withFeature } from '@/lib/infrastructure/adapters/with-feature';
import { ListRequestsSchema } from '@/lib/infrastructure/api-schemas/list-requests';
import { firstInvalidField, parseQuery } from '@/lib/infrastructure/api-schemas/parse';
import { RequestListFilter } from '@/lib/core/entity/request';

/** Rucio's own API takes request_states comma separated; accept that as well as repeated keys. */
function splitRequestStates(searchParams: URLSearchParams): URLSearchParams {
    const normalised = new URLSearchParams();
    searchParams.forEach((value, key) => {
        if (key !== 'request_states') {
            normalised.append(key, value);
            return;
        }
        value
            .split(',')
            .map(state => state.trim())
            .filter(state => state.length > 0)
            .forEach(state => normalised.append(key, state));
    });
    return normalised;
}

/**
 * GET /api/feature/list-requests
 * Query params: src_rse and dst_rse, or src_site and dst_site; request_states (optional, repeated or comma separated); activity (optional)
 * Streams the transfer requests of that link. Rucio's default policy only allows admin accounts.
 */
async function getHandler(request: NextRequest) {
    const parsed = parseQuery(ListRequestsSchema, splitRequestStates(request.nextUrl.searchParams));
    if (!parsed.success) {
        const field = firstInvalidField(parsed.error) ?? 'query';
        return NextResponse.json({ status: 'error', errorType: 'validation_error', message: `Invalid ${field}` }, { status: 400 });
    }
    const { src_rse, dst_rse, src_site, dst_site, request_states, activity } = parsed.data;
    const filter: RequestListFilter = {
        srcRse: src_rse,
        dstRse: dst_rse,
        srcSite: src_site,
        dstSite: dst_site,
        requestStates: request_states,
        activity,
    };

    const controller = appContainer.get<BaseController<ListRequestsControllerParameters, void>>(CONTROLLERS.LIST_REQUESTS);
    return executeAuthenticatedController(controller, { filter }, true);
}

export const GET = withFeature(CONTROLLERS.LIST_REQUESTS, getHandler);
