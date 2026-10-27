/**
 * Below Tailwind's md breakpoint the panel is a full-screen sheet that can shrink to a bubble.
 * Same value as ASSISTANT_MOBILE_QUERY in useAssistantShell.tsx (phase 1b); kept here so tools do not import the shell.
 */
export const MOBILE_MEDIA_QUERY = '(max-width: 767px)';

export function isMobileViewport(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function normalisePathname(pathname: string): string {
    let decoded = pathname;
    try {
        decoded = decodeURIComponent(pathname);
    } catch {
        // keep the raw pathname when it is not valid percent-encoding
    }
    const trimmed = decoded.replace(/\/+$/, '');
    return trimmed === '' ? '/' : trimmed;
}

export function samePathname(a: string, b: string): boolean {
    return normalisePathname(a) === normalisePathname(b);
}

/** 'jdoe@def' gives 'jdoe'. Rucio account names never contain '@'. */
export function accountFromKey(accountKey: string): string {
    const at = accountKey.lastIndexOf('@');
    return at === -1 ? accountKey : accountKey.slice(0, at);
}
