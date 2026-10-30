import { BaseErrorResponseModel, BaseResponseModel } from '@/lib/sdk/usecase-models';
import { RequestListFilter, TransferRequest } from '@/lib/core/entity/request';

/**
 * @interface ListRequestsRequest represents the RequestModel for list_requests usecase
 */
export interface ListRequestsRequest {
    filter: RequestListFilter;
}

/**
 * @interface ListRequestsResponse represents the ResponseModel for list_requests usecase (one streamed row)
 */
export interface ListRequestsResponse extends BaseResponseModel, TransferRequest {}

/**
 * @interface ListRequestsError represents the ErrorModel for list_requests usecase
 */
export interface ListRequestsError extends BaseErrorResponseModel {}
