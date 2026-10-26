import { BaseViewModel } from '@/lib/sdk/view-models';
import { TransferRequest } from '@/lib/core/entity/request';

export interface FTSLinkViewModel extends BaseViewModel {
    url: string;
}

export interface DDMLinkViewModel extends BaseViewModel {
    url: string;
    errorType?: 'feature_disabled' | 'config_not_found' | 'unknown';
}

export type RequestListErrorType = 'validation_error' | 'unauthorized' | 'permission_denied' | 'not_found' | 'unknown';

/** One NDJSON row of /api/feature/list-requests. Error rows carry errorType and message. */
export interface TransferRequestViewModel extends BaseViewModel, TransferRequest {
    errorType?: RequestListErrorType;
}

export function generateEmptyTransferRequestViewModel(): TransferRequestViewModel {
    return {
        status: 'error',
        id: '',
        requestType: '',
        scope: '',
        name: '',
        didType: '',
        state: 'UNKNOWN',
        activity: null,
        bytes: null,
        sourceRse: null,
        destRse: '',
        account: null,
        ruleId: null,
        retryCount: 0,
        priority: null,
        transfertool: null,
        externalHost: null,
        externalId: null,
        errMsg: null,
        createdAt: null,
        updatedAt: null,
        requestedAt: null,
        submittedAt: null,
        startedAt: null,
        transferredAt: null,
    };
}
