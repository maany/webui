import type { PageContext } from '@/lib/core/entity/assistant/page-context';
import { isSecretFieldName, normaliseFieldName } from '@/lib/core/services/assistant-secret-keys';

export const PAGE_SUMMARY_MAX_CHARS = 500;
const TITLE_MAX_CHARS = 200;
const PATHNAME_MAX_CHARS = 512;
const PARAM_KEY_MAX_CHARS = 64;
const PARAM_VALUE_MAX_CHARS = 256;
const MAX_PARAMS = 30;

/** Param names dropped on top of the shared secret-name rule: OAuth codes and generic keys. */
const PARAM_ONLY_SENSITIVE_KEYS = new Set(['code', 'key']);

/** Credential-like param names: the shared secret-name rule plus code and key. */
function isSensitiveParamKey(key: string): boolean {
    return isSecretFieldName(key) || PARAM_ONLY_SENSITIVE_KEYS.has(normaliseFieldName(key));
}

const CLOSING_DATA_TAG = /(?:<|&lt;)\s*\/\s*(?:page_context|conversation_summary)\b/i;
const CLOSING_DATA_TAG_ALL = new RegExp(CLOSING_DATA_TAG.source, 'gi');

/**
 * Removes closing tags of the untrusted-data blocks so text cannot end the block early.
 * Matches after NFKC normalisation and format-character stripping, so full-width,
 * zero-width, entity and spaced variants are caught too.
 */
export function neutraliseDataTags(text: string): string {
    const normalised = text.normalize('NFKC').replace(/\p{Cf}/gu, '');
    // Benign text is returned untouched; only text hiding a closing tag is rewritten.
    return CLOSING_DATA_TAG.test(normalised) ? normalised.replace(CLOSING_DATA_TAG_ALL, '[removed tag]') : text;
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
    const params: Record<string, string> = Object.create(null);
    input.searchParams?.forEach((value, key) => {
        if (isSensitiveParamKey(key)) return;
        const safeKey = toSingleLine(truncate(key, PARAM_KEY_MAX_CHARS));
        if (!Object.hasOwn(params, safeKey) && Object.keys(params).length >= MAX_PARAMS) return;
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
    return `The user is now on ${toSingleLine(truncate(context.route, PATHNAME_MAX_CHARS))}.`;
}

/** `${account}@${vo}` from the two session fields, or undefined when either is missing. */
export function toAccountKey(account: string | undefined | null, vo: string | undefined | null): string | undefined {
    if (!account || !vo) return undefined;
    return `${account}@${vo}`;
}
