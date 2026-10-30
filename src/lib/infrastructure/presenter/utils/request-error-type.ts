import { RequestListErrorType } from '@/lib/infrastructure/data/view-model/request';

const VALIDATION_CLASSES = new Set(['ValidationError', 'MissingParameter', 'Invalid', 'InvalidObject']);
const NOT_FOUND_CLASSES = new Set(['RSENotFound', 'NotFound']);

/**
 * Rucio's /requests/list lets AccessDenied and RSENotFound escape as HTTP 500,
 * so the exception class decides before the status code does.
 */
export function toRequestListError(code: number, errorClass?: string): { errorType: RequestListErrorType; status: number } {
    if (errorClass === 'AccessDenied' || code === 403) return { errorType: 'permission_denied', status: 403 };
    if (code === 401) return { errorType: 'unauthorized', status: 401 };
    if (code === 404 || (errorClass !== undefined && NOT_FOUND_CLASSES.has(errorClass))) return { errorType: 'not_found', status: 404 };
    if (code === 400 || (errorClass !== undefined && VALIDATION_CLASSES.has(errorClass))) return { errorType: 'validation_error', status: 400 };
    return { errorType: 'unknown', status: code >= 400 ? code : 500 };
}

/** User facing message; falls back to the Rucio or validation message. No em dashes. */
export function toRequestListErrorMessage(errorType: RequestListErrorType, fallback: string): string {
    if (errorType === 'permission_denied') return 'Only Rucio admins can list transfer requests on this server.';
    if (errorType === 'unauthorized') return 'Your session has expired. Please sign in again.';
    if (errorType === 'not_found') return 'The source or destination RSE or site was not found.';
    return fallback || 'Something went wrong. Please try again.';
}
