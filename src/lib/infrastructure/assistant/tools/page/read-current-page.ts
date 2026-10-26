import { z } from 'zod';
import type { PageActionInfo } from '@/lib/core/port/secondary/assistant-page-action-registry-port';
import { isSecretFieldName } from '@/lib/core/services/assistant-secret-keys';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import { buildPageContext, neutraliseDataTags } from '@/lib/infrastructure/assistant/page-context';

export const READ_PAGE_TEXT_MAX = 4000;
const FIELD_LIMIT = 20;
const FIELD_VALUE_MAX = 200;
const STRIPPED_SELECTOR = 'script, style, noscript, template, svg, [hidden], [aria-hidden="true"], input[type="password"], input[type="hidden"]';
const SKIPPED_INPUT_TYPES = new Set(['password', 'hidden', 'file', 'submit', 'button', 'reset', 'image']);

export const ReadCurrentPageInputSchema = z.object({});
export type ReadCurrentPageInput = z.infer<typeof ReadCurrentPageInputSchema>;

export interface PageField {
    label: string;
    value: string;
}

export interface CurrentPageResult {
    route: string;
    params: Record<string, string>;
    title: string;
    summary?: string;
    text?: string;
    fields?: PageField[];
    actions: PageActionInfo[];
    truncated: boolean;
}

export const READ_CURRENT_PAGE_DESCRIPTION =
    'Read what the user sees: route, search params, title, and either the page summary or the visible text and form ' +
    'values of the main area (password and hidden fields are never included). Also lists the actions for page_action.';

type FieldElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function collapseWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function readMainText(main: Element): string {
    const clone = main.cloneNode(true) as Element;
    clone.querySelectorAll(STRIPPED_SELECTOR).forEach(node => node.remove());
    const walker = main.ownerDocument.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const value = node.nodeValue?.trim();
        if (value) parts.push(value);
    }
    return collapseWhitespace(parts.join(' '));
}

function fieldLabel(element: FieldElement): string {
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel && collapseWhitespace(ariaLabel)) return collapseWhitespace(ariaLabel);
    const labelText = element.labels && element.labels.length > 0 ? collapseWhitespace(element.labels[0].textContent ?? '') : '';
    if (labelText) return labelText;
    return element.getAttribute('name') ?? element.getAttribute('placeholder') ?? (element.id || 'field');
}

/** True when the name, id, label text or autocomplete value of a field says it holds a secret. */
function isSecretField(element: FieldElement): boolean {
    const candidates = [
        element.getAttribute('name'),
        element.id,
        element.getAttribute('aria-label'),
        element.getAttribute('autocomplete'),
        ...Array.from(element.labels ?? []).map(label => label.textContent),
    ];
    return candidates.some(candidate => !!candidate && isSecretFieldName(candidate));
}

function fieldValue(element: FieldElement): string | undefined {
    if (element instanceof HTMLInputElement) {
        const type = element.type.toLowerCase();
        if (SKIPPED_INPUT_TYPES.has(type)) return undefined;
        if (type === 'checkbox' || type === 'radio') return element.checked ? 'checked' : 'unchecked';
    }
    if ((element.getAttribute('autocomplete') ?? '').toLowerCase().includes('password')) return undefined;
    if (element instanceof HTMLSelectElement) {
        const selected = element.selectedOptions[0];
        return selected ? collapseWhitespace(selected.textContent ?? '') || element.value : element.value;
    }
    return element.value;
}

function readFields(main: Element): PageField[] {
    const fields: PageField[] = [];
    main.querySelectorAll<FieldElement>('input, textarea, select').forEach(element => {
        if (fields.length >= FIELD_LIMIT) return;
        if (element.closest('[hidden], [aria-hidden="true"]')) return;
        if (isSecretField(element)) return;
        const value = fieldValue(element);
        if (!value) return;
        fields.push({ label: fieldLabel(element), value: value.slice(0, FIELD_VALUE_MAX) });
    });
    return fields;
}

function safeDescribe(describe: () => string | undefined): string | undefined {
    try {
        return describe()?.trim() || undefined;
    } catch {
        return undefined;
    }
}

export function createReadCurrentPageTool(): RegisteredTool<ReadCurrentPageInput> {
    return {
        spec: {
            name: 'read_current_page',
            domain: 'core',
            description: READ_CURRENT_PAGE_DESCRIPTION,
            input: ReadCurrentPageInputSchema,
            risk: 'read',
            requires: { flags: [] },
            executor: 'page',
            output: 'object',
            alwaysOn: true,
            describeCall: () => 'Read the current page',
        },
        async execute(_args, ctx) {
            // Route, params and title go through the same sanitising as the page context of a turn.
            const context = buildPageContext({
                pathname: window.location.pathname,
                searchParams: new URLSearchParams(window.location.search),
                title: document.title,
                accountKey: ctx.accountKey,
            });
            const base = {
                route: context.route,
                params: Object.fromEntries(Object.entries(context.params)),
                title: context.title,
                actions: ctx.pages.list(),
            };

            const rawSummary = safeDescribe(() => ctx.pages.describe());
            const summary = rawSummary ? neutraliseDataTags(rawSummary) : undefined;
            if (summary) {
                const result: CurrentPageResult = { ...base, summary, truncated: false };
                return result;
            }

            const main = document.querySelector('main#main-content');
            if (!main) {
                const result: CurrentPageResult = { ...base, text: '', fields: [], truncated: false };
                return result;
            }

            const text = neutraliseDataTags(readMainText(main));
            const truncated = text.length > READ_PAGE_TEXT_MAX;
            const result: CurrentPageResult = {
                ...base,
                text: truncated ? text.slice(0, READ_PAGE_TEXT_MAX) : text,
                fields: readFields(main),
                truncated,
            };
            return result;
        },
    };
}
