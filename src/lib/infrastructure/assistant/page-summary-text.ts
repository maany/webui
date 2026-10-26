import { PAGE_SUMMARY_MAX_CHARS } from './page-context';

/** Longest page summary attached to a turn (spec 8.1). Same cap phase 1b's registry and page context apply. */
export const PAGE_SUMMARY_MAX = PAGE_SUMMARY_MAX_CHARS;

/** Collapses whitespace and cuts to `max` characters, ending with "..." when cut. */
export function clampSummary(text: string, max: number = PAGE_SUMMARY_MAX): string {
    const collapsed = text.replace(/\s+/g, ' ').trim();
    if (collapsed.length <= max) return collapsed;
    return `${collapsed.slice(0, max - 3)}...`;
}
