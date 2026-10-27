/** Longest stored conversation title, shared by the generated title and a user rename. */
export const CONVERSATION_TITLE_MAX_CHARS = 60;

/** Single-line, trimmed title capped at the limit; undefined when nothing is left. */
export function normalizeConversationTitle(raw: string): string | undefined {
    const title = raw.replace(/\s+/g, ' ').trim().slice(0, CONVERSATION_TITLE_MAX_CHARS).trim();
    return title === '' ? undefined : title;
}
