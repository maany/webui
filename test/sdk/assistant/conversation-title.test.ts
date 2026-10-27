import { CONVERSATION_TITLE_MAX_CHARS, normalizeConversationTitle } from '@/lib/core/services/assistant-conversation-title';

describe('normalizeConversationTitle', () => {
    it('trims and collapses whitespace and newlines to single spaces', () => {
        expect(normalizeConversationTitle('  stuck \n\n rules\t at   CERN  ')).toBe('stuck rules at CERN');
    });

    it('caps the title at the limit', () => {
        const result = normalizeConversationTitle('a'.repeat(200));
        expect(result).toHaveLength(CONVERSATION_TITLE_MAX_CHARS);
    });

    it('returns undefined for an empty or blank title', () => {
        expect(normalizeConversationTitle('')).toBeUndefined();
        expect(normalizeConversationTitle(' \n\t ')).toBeUndefined();
    });
});
