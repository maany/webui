import 'reflect-metadata';
import { NextRequest, NextResponse } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import { BaseController } from '@/lib/sdk/controller';
import { AddDIDControllerParameters } from '@/lib/infrastructure/controller/add-did-controller';
import { AddDIDRequest } from '@/lib/core/usecase-models/add-did-usecase-models';
import { executeAuthenticatedController, parseRequestBody } from '@/lib/infrastructure/adapters/app-router-controller-adapter';
import { withFeature } from '@/lib/infrastructure/adapters/with-feature';
import { AddDidSchema } from '@/lib/infrastructure/api-schemas/add-did';

/**
 * POST /api/feature/add-did
 * Body: { scope, name, type: 'Dataset' | 'Container' }
 * Creates a new DID (Data Identifier)
 */
async function postHandler(request: NextRequest) {
    try {
        const body = await parseRequestBody(request);

        if (!body) {
            return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
        }

        const params = AddDidSchema.safeParse(body);
        if (!params.success) {
            return NextResponse.json(
                {
                    error: 'Missing required parameters or provided parameters are invalid',
                    details: params.error.issues,
                },
                { status: 400 },
            );
        }

        const controller = appContainer.get<BaseController<AddDIDControllerParameters, AddDIDRequest>>(CONTROLLERS.ADD_DID);

        return executeAuthenticatedController(controller, params.data);
    } catch (error) {
        console.error('Error in add-did:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export const POST = withFeature(CONTROLLERS.ADD_DID, postHandler);
