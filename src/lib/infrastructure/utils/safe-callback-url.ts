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
