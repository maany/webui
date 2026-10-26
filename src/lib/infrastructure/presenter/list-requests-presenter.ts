import { ListRequestsError, ListRequestsResponse } from '@/lib/core/usecase-models/list-requests-usecase-models';
import { TransferRequestViewModel, generateEmptyTransferRequestViewModel } from '@/lib/infrastructure/data/view-model/request';
import { BaseStreamingPresenter } from '@/lib/sdk/presenter';
import { ListRequestsOutputPort } from '@/lib/core/port/primary/list-requests-ports';
import { toRequestListError, toRequestListErrorMessage } from '@/lib/infrastructure/presenter/utils/request-error-type';

export default class ListRequestsPresenter
    extends BaseStreamingPresenter<ListRequestsResponse, ListRequestsError, TransferRequestViewModel>
    implements ListRequestsOutputPort
{
    streamResponseModelToViewModel(responseModel: ListRequestsResponse): TransferRequestViewModel {
        return { ...responseModel };
    }

    streamErrorModelToViewModel(error: ListRequestsError): TransferRequestViewModel {
        return this.errorViewModel(error).viewModel;
    }

    /**
     * Converts an error model to an error view model.
     * @param errorModel The error model to convert.
     * @returns The error view model and the HTTP status from the error type (AccessDenied is 403 even when Rucio sent 500).
     */
    convertErrorModelToViewModel(errorModel: ListRequestsError): { viewModel: TransferRequestViewModel; status: number } {
        return this.errorViewModel(errorModel);
    }

    private errorViewModel(errorModel: ListRequestsError): { viewModel: TransferRequestViewModel; status: number } {
        // name carries Rucio's ExceptionClass via handleCommonGatewayErrors
        const { errorType, status } = toRequestListError(errorModel.code ? errorModel.code : 500, errorModel.name);
        const viewModel = generateEmptyTransferRequestViewModel();
        viewModel.errorType = errorType;
        viewModel.message = toRequestListErrorMessage(errorType, errorModel.message ? errorModel.message.toString() : errorModel.name);
        return { status, viewModel };
    }
}
