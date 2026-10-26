import ListRequestsPresenter from '@/lib/infrastructure/presenter/list-requests-presenter';
import { ListRequestsError, ListRequestsResponse } from '@/lib/core/usecase-models/list-requests-usecase-models';
import { RequestListErrorType, TransferRequestViewModel } from '@/lib/infrastructure/data/view-model/request';
import { Signal } from '@/lib/sdk/web';
import { createHttpMocks } from 'test/fixtures/http-fixtures';
import { expectedTransferRequest } from 'test/fixtures/request-fixtures';

const presenterWithResponse = async () => {
    const { res } = await createHttpMocks('/api/feature/list-requests', 'GET');
    return { res, presenter: new ListRequestsPresenter(res as unknown as Signal<TransferRequestViewModel>) };
};

describe('ListRequestsPresenter', () => {
    it('passes rows through unchanged', async () => {
        const { presenter } = await presenterWithResponse();
        const model: ListRequestsResponse = { status: 'success', ...expectedTransferRequest() };
        expect(presenter.streamResponseModelToViewModel(model)).toEqual(model);
    });

    const cases: [Pick<ListRequestsError, 'code' | 'name' | 'message'>, number, RequestListErrorType, string][] = [
        [
            { code: 500, name: 'AccessDenied', message: 'jdoe cannot list requests' },
            403,
            'permission_denied',
            'Only Rucio admins can list transfer requests on this server.',
        ],
        [
            { code: 500, name: 'RSENotFound', message: 'RSE does not exist.' },
            404,
            'not_found',
            'The source or destination RSE or site was not found.',
        ],
        [
            { code: 400, name: 'ValidationError', message: 'Give both src_rse and dst_rse.' },
            400,
            'validation_error',
            'Give both src_rse and dst_rse.',
        ],
        [{ code: 401, name: 'CannotAuthenticate', message: 'token expired' }, 401, 'unauthorized', 'Your session has expired. Please sign in again.'],
    ];

    it.each(cases)('presents %j as HTTP %s %s', async (error, status, errorType, message) => {
        const { res, presenter } = await presenterWithResponse();
        presenter.presentError({ status: 'error', ...error } as ListRequestsError);
        expect(res._getStatusCode()).toBe(status);
        expect(res._getJSONData()).toMatchObject({ status: 'error', errorType, message });
    });

    it('turns a failed row into an error row', async () => {
        const { presenter } = await presenterWithResponse();
        const errorRow = presenter.streamErrorModelToViewModel({
            status: 'error',
            code: 500,
            name: 'Gateway Error',
            message: 'bad line',
        } as ListRequestsError);
        expect(errorRow).toMatchObject({ status: 'error', errorType: 'unknown', message: 'bad line' });
    });
});
