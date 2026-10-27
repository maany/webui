import { toolError } from '@/lib/infrastructure/assistant/page-tool-errors';
import { ACCOUNT_CHANGED_READ_MESSAGE, ACCOUNT_MISMATCH_ERROR_TYPE, ASSISTANT_ACCOUNT_HEADER } from '@/lib/infrastructure/assistant/account-binding';

export interface FetchNdjsonOptions extends RequestInit {
    /** `account@vo` the read runs as; the server answers 409 account_mismatch when the session account differs. */
    expectedAccount?: string;
}

async function isAccountMismatchBody(response: Response): Promise<boolean> {
    try {
        const body: unknown = JSON.parse(await response.text());
        return typeof body === 'object' && body !== null && (body as { errorType?: unknown }).errorType === ACCOUNT_MISMATCH_ERROR_TYPE;
    } catch {
        return false;
    }
}

/**
 * Reads a streamed /api/feature route into rows. The proxy answers an expired session with a redirect
 * to the login page, which fetch follows: that HTML becomes session_expired instead of a JSON.parse crash.
 */
export async function fetchNdjsonRows<T>(url: string, options: FetchNdjsonOptions = {}): Promise<T[]> {
    const { expectedAccount, ...rest } = options;
    const init: RequestInit = expectedAccount
        ? { ...rest, headers: { ...(rest.headers as Record<string, string> | undefined), [ASSISTANT_ACCOUNT_HEADER]: expectedAccount } }
        : rest;
    let response: Response;
    try {
        response = await fetch(url, init);
    } catch {
        if (init.signal?.aborted) throw toolError('aborted', 'The request was stopped.');
        throw toolError('unavailable', `Could not reach ${url.split('?')[0]}.`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (response.redirected || contentType.includes('text/html'))
        throw toolError('session_expired', 'The session expired. Log in again, then retry.');
    if (response.status === 409 && (await isAccountMismatchBody(response)))
        throw toolError('denied_by_policy', ACCOUNT_CHANGED_READ_MESSAGE, ACCOUNT_MISMATCH_ERROR_TYPE);
    if (response.status === 401) throw toolError('unauthorized', 'Rucio did not accept the session.');
    if (response.status === 403) throw toolError('forbidden', 'Rucio refused the request.');
    if (response.status === 404) throw toolError('not_found', 'Nothing was found.');
    if (!response.ok) throw toolError('rucio_error', `The request failed with status ${response.status}.`);

    const rows: T[] = [];
    for (const line of (await response.text()).split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const row: unknown = JSON.parse(trimmed);
            if (typeof row !== 'object' || row === null) throw new Error('not an object');
            rows.push(row as T);
        } catch {
            throw toolError('stream_error', 'The server sent a malformed line.');
        }
    }
    return rows;
}
