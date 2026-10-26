import type { PageContext } from '@/lib/core/entity/assistant/page-context';

export const PAGE_SUMMARY_MAX_CHARS = 500;
const TITLE_MAX_CHARS = 200;
const PATHNAME_MAX_CHARS = 512;
const PARAM_KEY_MAX_CHARS = 64;
const PARAM_VALUE_MAX_CHARS = 256;
const MAX_PARAMS = 30;

/** Param names that commonly carry credentials; matched case-insensitively with - and _ ignored. */
const SENSITIVE_PARAM_KEYS = new Set(
    [
        'token',
        'code',
        'state',
        'access_token',
        'id_token',
        'refresh_token',
        'password',
        'secret',
        'key',
        'apikey',
        'api_key',
        'session',
        'auth',
        'authorization',
    ].map(normaliseParamKey),
);

function normaliseParamKey(key: string): string {
    return key.toLowerCase().replace(/[-_]/g, '');
}

/** Breaks the closing tags of the untrusted-data blocks so text cannot end the block early. */
export function neutraliseDataTags(text: string): string {
    return text.replace(/<\s*\/(?=\s*(?:page_context|conversation_summary)\b)/gi, '<\\/');
}

/** Single-line, tag-safe text for a field of the page context. */
export function toSingleLine(text: string): string {
    return neutraliseDataTags(text.replace(/[\r\n\u2028\u2029]+/g, ' '));
}

function truncate(text: string, limit: number): string {
    return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

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
        if (SENSITIVE_PARAM_KEYS.has(normaliseParamKey(key))) return;
        const safeKey = toSingleLine(truncate(key, PARAM_KEY_MAX_CHARS));
        if (!(safeKey in params) && Object.keys(params).length >= MAX_PARAMS) return;
        params[safeKey] = toSingleLine(truncate(value, PARAM_VALUE_MAX_CHARS));
    });
    const summary = input.summary?.trim();
    return {
        route: toSingleLine(truncate(input.pathname, PATHNAME_MAX_CHARS)),
        params,
        title: toSingleLine(input.title.slice(0, TITLE_MAX_CHARS)),
        accountKey: input.accountKey,
        ...(summary ? { summary: toSingleLine(summary.slice(0, PAGE_SUMMARY_MAX_CHARS)) } : {}),
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
