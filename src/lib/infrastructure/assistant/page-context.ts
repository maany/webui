import type { PageContext } from '@/lib/core/entity/assistant/page-context';

export const PAGE_SUMMARY_MAX_CHARS = 500;
const TITLE_MAX_CHARS = 200;
const PARAM_VALUE_MAX_CHARS = 200;

export interface PageContextInput {
    pathname: string;
    searchParams: URLSearchParams | { forEach(callback: (value: string, key: string) => void): void } | null;
    title: string;
    /** `${account}@${vo}`. Callers pass only these two session fields, never the session object. */
    accountKey: string;
    summary?: string;
}

/**
 * Builds the page context attached to a user turn. Takes primitives only so
 * no session object or token can reach the prompt through it.
 */
export function buildPageContext(input: PageContextInput): PageContext {
    const params: Record<string, string> = {};
    input.searchParams?.forEach((value, key) => {
        params[key] = value.slice(0, PARAM_VALUE_MAX_CHARS);
    });
    const summary = input.summary?.trim();
    return {
        route: input.pathname,
        params,
        title: input.title.slice(0, TITLE_MAX_CHARS),
        accountKey: input.accountKey,
        ...(summary ? { summary: summary.slice(0, PAGE_SUMMARY_MAX_CHARS) } : {}),
    };
}

/** The note added to the next turn when the user moved to another page. */
export function navigationNote(previousRoute: string | undefined, context: PageContext): string | undefined {
    if (!previousRoute || previousRoute === context.route) return undefined;
    return `The user is now on ${context.route}.`;
}

/** `${account}@${vo}` from the two session fields, or undefined when either is missing. */
export function toAccountKey(account: string | undefined | null, vo: string | undefined | null): string | undefined {
    if (!account || !vo) return undefined;
    return `${account}@${vo}`;
}
