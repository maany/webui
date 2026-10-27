/** Relative links ("/rule/123") stay in the app; everything else opens in a new tab. */
export function isInAppHref(href: string | undefined): href is string {
    if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//')) return false;
    // Browsers normalise '/\\evil.com' to '//evil.com', so reject backslashes, whitespace and control characters too.
    for (const char of href) {
        const code = char.charCodeAt(0);
        if (char === '\\' || code <= 0x20 || code === 0x7f || /\s/.test(char)) return false;
    }
    return true;
}

const BLOCKED_FIRST_SEGMENTS = new Set(['auth', 'api']);

/**
 * True when a URL built for navigate may be pushed to the router: an in-app path whose pathname the browser
 * would not rewrite (no dot segments, so an encoded-looking '..' cannot climb to /auth) and that is not an
 * auth or api route.
 */
export function isSafeNavigateUrl(url: string): boolean {
    if (!isInAppHref(url)) return false;
    try {
        const pathname = url.split(/[?#]/)[0];
        if (new URL(url, 'http://localhost').pathname !== pathname) return false;
        const first = pathname.split('/')[1] ?? '';
        return !BLOCKED_FIRST_SEGMENTS.has(first.toLowerCase());
    } catch {
        return false;
    }
}
