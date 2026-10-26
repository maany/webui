import { BaseAuthenticatedInputPort, BaseStreamingOutputPort } from '@/lib/sdk/primary-ports';
import { ListRequestsError, ListRequestsRequest, ListRequestsResponse } from '@/lib/core/usecase-models/list-requests-usecase-models';
import { TransferRequestViewModel } from '@/lib/infrastructure/data/view-model/request';

/**
 * @interface ListRequestsInputPort that abstracts the usecase.
 */
export interface ListRequestsInputPort extends BaseAuthenticatedInputPort<ListRequestsRequest> {}

/**
 * @interface ListRequestsOutputPort that abstracts the presenter
 */
export interface ListRequestsOutputPort extends BaseStreamingOutputPort<ListRequestsResponse, ListRequestsError, TransferRequestViewModel> {}
