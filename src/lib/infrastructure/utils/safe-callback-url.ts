/**
 * Returns a safe same-origin relative path for post-login navigation.
 * Accepts only paths starting with a single "/" (not "//" or "/\").
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
    return /^\/(?![\/\\])/.test(decoded) ? decoded : '/';
}
