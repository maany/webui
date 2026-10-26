import { toRequestListError, toRequestListErrorMessage } from '@/lib/infrastructure/presenter/utils/request-error-type';
import { generateEmptyTransferRequestViewModel, RequestListErrorType } from '@/lib/infrastructure/data/view-model/request';

const EM_DASH = String.fromCharCode(0x2014);

describe('toRequestListError', () => {
    const cases: [number, string | undefined, RequestListErrorType, number][] = [
        [500, 'AccessDenied', 'permission_denied', 403],
        [401, 'AccessDenied', 'permission_denied', 403],
        [403, undefined, 'permission_denied', 403],
        [401, 'CannotAuthenticate', 'unauthorized', 401],
        [401, undefined, 'unauthorized', 401],
        [500, 'RSENotFound', 'not_found', 404],
        [404, 'NotFound', 'not_found', 404],
        [400, 'MissingParameter', 'validation_error', 400],
        [400, 'Invalid', 'validation_error', 400],
        [400, 'ValidationError', 'validation_error', 400],
        [500, undefined, 'unknown', 500],
        [502, 'Whatever', 'unknown', 502],
        [0, undefined, 'unknown', 500],
    ];

    it.each(cases)('%s + %s -> %s (HTTP %s)', (code, errorClass, errorType, status) => {
        expect(toRequestListError(code, errorClass)).toEqual({ errorType, status });
    });
});

describe('toRequestListErrorMessage', () => {
    const cases: [RequestListErrorType, string][] = [
        ['permission_denied', 'Only Rucio admins can list transfer requests on this server.'],
        ['unauthorized', 'Your session has expired. Please sign in again.'],
        ['not_found', 'The source or destination RSE or site was not found.'],
        ['validation_error', 'raw message'],
        ['unknown', 'raw message'],
    ];

    it.each(cases)('%s -> %s', (errorType, expected) => {
        const message = toRequestListErrorMessage(errorType, 'raw message');
        expect(message).toBe(expected);
        expect(message).not.toContain(EM_DASH);
    });

    it('uses a generic message when the fallback is empty', () => {
        expect(toRequestListErrorMessage('unknown', '')).toBe('Something went wrong. Please try again.');
    });
});

describe('generateEmptyTransferRequestViewModel', () => {
    it('is an error row with every field empty', () => {
        expect(generateEmptyTransferRequestViewModel()).toMatchObject({ status: 'error', id: '', state: 'UNKNOWN', bytes: null, destRse: '' });
    });
});
