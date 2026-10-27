/**
 * Returns a safe same-origin relative path for post-login navigation.
 * Accepts only paths starting with a single "/" (not "//" or "/\") and without control characters.
 * Anything else, including malformed encodings, falls back to "/".
 */
export function safeCallbackPath(raw: string | null | undefined): string {
    if (!raw) return '/';
    let decoded: string;
    try {
        decoded = decodeURIComponent(raw);
    } catch {
        return '/';
    }
    // Browsers drop tab and newline while parsing a URL, so "/\t/evil" would become "//evil": refuse control characters.
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(decoded)) return '/';
    return /^\/(?![/\\])/.test(decoded) ? decoded : '/';
}

const SAME_ORIGIN_PATH = /^\/(?![/\\])/;

/**
 * Appends query params to a same-origin relative path, keeping any existing query string and hash.
 * Params in `params` replace existing params with the same key. The result is always a relative path
 * (pathname + search + hash); input that is not a plain "/..." path falls back to "/".
 */
export function appendQueryParams(path: string, params: URLSearchParams): string {
    if (!SAME_ORIGIN_PATH.test(path)) path = '/';
    const url = new URL(path, 'http://localhost');
    params.forEach((_value, key) => url.searchParams.delete(key));
    params.forEach((value, key) => url.searchParams.append(key, value));
    const result = `${url.pathname}${url.search}${url.hash}`;
    return SAME_ORIGIN_PATH.test(result) ? result : '/';
}
