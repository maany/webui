import type { ChatMessage } from '@/lib/core/entity/assistant/conversation';
import { jsonBytes, selectConversationsToEvict, utf8Length } from '@/lib/core/services/assistant-retention';
import { messagesAfter, planCompaction, shouldCompact } from '@/lib/infrastructure/assistant/compaction';
import { conversationToJson, conversationToMarkdown, exportFileName } from '@/lib/infrastructure/assistant/conversation-export';
import { makeConversation } from 'test/fixtures/assistant-fixtures';

const MB = 1024 * 1024;
const now = new Date('2026-10-25T00:00:00.000Z');

describe('selectConversationsToEvict', () => {
    it('evicts conversations older than maxAgeDays', () => {
        const ids = selectConversationsToEvict(
            [
                { id: 'old', updatedAt: '2026-09-01T00:00:00.000Z', bytes: 10 },
                { id: 'new', updatedAt: '2026-10-20T00:00:00.000Z', bytes: 10 },
            ],
            { maxAgeDays: 30, maxTotalMB: 50, clearOnLogout: false },
            now,
        );
        expect(ids).toEqual(['old']);
    });

    it('evicts the oldest until the total fits in maxTotalMB', () => {
        const ids = selectConversationsToEvict(
            [
                { id: 'a', updatedAt: '2026-10-20T00:00:00.000Z', bytes: 2 * MB },
                { id: 'b', updatedAt: '2026-10-21T00:00:00.000Z', bytes: 2 * MB },
                { id: 'c', updatedAt: '2026-10-22T00:00:00.000Z', bytes: 2 * MB },
            ],
            { maxAgeDays: 30, maxTotalMB: 4, clearOnLogout: false },
            now,
        );
        expect(ids).toEqual(['a']);
    });

    it('never evicts protected conversations but counts their bytes', () => {
        const ids = selectConversationsToEvict(
            [
                { id: 'open', updatedAt: '2026-10-01T00:00:00.000Z', bytes: 3 * MB },
                { id: 'b', updatedAt: '2026-10-21T00:00:00.000Z', bytes: 2 * MB },
                { id: 'c', updatedAt: '2026-10-22T00:00:00.000Z', bytes: 2 * MB },
            ],
            { maxAgeDays: 30, maxTotalMB: 4, clearOnLogout: false },
            now,
            ['open'],
        );
        expect(ids).toEqual(['b', 'c']);
        const aged = selectConversationsToEvict(
            [{ id: 'open', updatedAt: '2026-08-01T00:00:00.000Z', bytes: 1 }],
            { maxAgeDays: 30, maxTotalMB: 50, clearOnLogout: false },
            now,
            ['open'],
        );
        expect(aged).toEqual([]);
    });

    it('counts UTF-8 bytes', () => {
        expect(utf8Length('aé€😀')).toBe(1 + 2 + 3 + 4);
        expect(jsonBytes({ a: 'é' })).toBe(utf8Length('{"a":"é"}'));
    });
});

function turn(n: number): ChatMessage[] {
    return [
        { id: `u${n}`, conversationId: 'c', role: 'user', parts: [{ type: 'text', text: `q${n}` }], createdAt: `2026-10-25T10:00:0${n}.000Z` },
        { id: `a${n}`, conversationId: 'c', role: 'assistant', parts: [{ type: 'text', text: `a${n}` }], createdAt: `2026-10-25T10:00:0${n}.500Z` },
    ];
}

describe('compaction planning', () => {
    it('compacts only above 70%', () => {
        expect(shouldCompact(null)).toBe(false);
        expect(shouldCompact(0.7)).toBe(false);
        expect(shouldCompact(0.71)).toBe(true);
    });

    it('keeps the last 4 turns and summarises the rest', () => {
        const history = [1, 2, 3, 4, 5, 6].flatMap(turn);
        const plan = planCompaction(history);
        expect(plan?.summarize.map(message => message.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
        expect(plan?.keep.map(message => message.id)).toEqual(['u3', 'a3', 'u4', 'a4', 'u5', 'a5', 'u6', 'a6']);
        expect(plan?.upToMessageId).toBe('a2');
        expect(planCompaction([1, 2, 3, 4].flatMap(turn))).toBeUndefined();
        expect(messagesAfter(history, 'a2').map(message => message.id)[0]).toBe('u3');
        expect(messagesAfter(history, undefined)).toBe(history);
    });
});

describe('conversation export', () => {
    const conversation = { ...makeConversation('c1', 'root@def', '2026-10-25T10:00:00.000Z'), title: 'Stuck rules on CERN!' };
    const messages: ChatMessage[] = [
        { id: 'u1', conversationId: 'c1', role: 'user', parts: [{ type: 'text', text: 'Why stuck?' }], createdAt: 'x' },
        {
            id: 'a1',
            conversationId: 'c1',
            role: 'assistant',
            createdAt: 'y',
            parts: [
                { type: 'tool-call', toolCallId: 't', toolName: 'get_rule', args: { id: 'r' }, policy: 'allow', status: 'done', result: {} },
                { type: 'text', text: 'Because of **quota**.' },
            ],
        },
    ];

    it('exports Markdown with roles and tool calls', () => {
        const markdown = conversationToMarkdown(conversation, messages);
        expect(markdown).toContain('# Stuck rules on CERN!');
        expect(markdown).toContain('## You\n\nWhy stuck?');
        expect(markdown).toContain('> Tool `get_rule` (done)');
        expect(markdown).toContain('## Rucio bot');
        expect(markdown).not.toContain(String.fromCharCode(0x2014));
    });

    it('exports JSON with a format marker and safe file names', () => {
        expect(JSON.parse(conversationToJson(conversation, messages))).toMatchObject({
            format: 'rucio-assistant-conversation',
            version: 1,
            conversation: { id: 'c1' },
        });
        expect(exportFileName(conversation, 'md')).toBe('rucio-bot-stuck-rules-on-cern-2026-10-25.md');
    });
});
