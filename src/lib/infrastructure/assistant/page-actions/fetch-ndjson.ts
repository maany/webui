import { toolError } from '@/lib/infrastructure/assistant/page-tool-errors';

/**
 * Reads a streamed /api/feature route into rows. The proxy answers an expired session with a redirect
 * to the login page, which fetch follows: that HTML becomes session_expired instead of a JSON.parse crash.
 */
export async function fetchNdjsonRows<T>(url: string, init: RequestInit = {}): Promise<T[]> {
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
    if (response.status === 401) throw toolError('unauthorized', 'Rucio did not accept the session.');
    if (response.status === 403) throw toolError('forbidden', 'Rucio refused the request.');
    if (response.status === 404) throw toolError('not_found', 'Nothing was found.');
    if (!response.ok) throw toolError('rucio_error', `The request failed with status ${response.status}.`);

    const rows: T[] = [];
    for (const line of (await response.text()).split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            rows.push(JSON.parse(trimmed) as T);
        } catch {
            throw toolError('stream_error', 'The server sent a malformed line.');
        }
    }
    return rows;
}
