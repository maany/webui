import type { ChatMessage, MessagePart } from '@/lib/core/entity/assistant/conversation';
import { RUN_SQL_TOOL_NAME } from '@/lib/core/entity/assistant/tool';
import { activityLabel, summarizeActivity } from '@/component-library/features/assistant/format';

const EM_DASH = String.fromCharCode(0x2014);

const toolCall = (toolName: string): MessagePart => ({
    type: 'tool-call',
    toolCallId: `${toolName}-${Math.random()}`,
    toolName,
    args: {},
    policy: 'allow',
    status: 'done',
});

const message = (parts: MessagePart[], usage?: ChatMessage['usage']): ChatMessage => ({
    id: 'm1',
    conversationId: 'c1',
    role: 'assistant',
    parts,
    createdAt: '2026-10-25T10:00:00.000Z',
    ...(usage ? { usage } : {}),
});

describe('activity label with SQL queries', () => {
    it('produces the spec example line', () => {
        const parts: MessagePart[] = [
            { type: 'reasoning', text: 'thinking', durationMs: 4000 },
            toolCall('find_tools'),
            toolCall('list_rules'),
            toolCall('get_rule'),
            toolCall(RUN_SQL_TOOL_NAME),
            { type: 'text', text: 'answer' },
        ];
        const label = activityLabel(summarizeActivity(message(parts, { inputTokens: 12_400, outputTokens: 800, costUSD: 0.04, durationMs: 9000 })));
        expect(label).toBe('Thought 4s · 3 tools · 1 query · 12.4k / 800 tok · $0.04');
    });

    it('counts run_sql calls as queries, not tools', () => {
        const summary = summarizeActivity(
            message([toolCall('run_sql'), toolCall('run_sql')], { inputTokens: 50, outputTokens: 20, costUSD: null, durationMs: 2600 }),
        );
        expect(summary.toolCount).toBe(0);
        expect(summary.queryCount).toBe(2);
        expect(activityLabel(summary)).toBe('2 queries · 50 / 20 tok');
    });

    it('uses singular words', () => {
        expect(activityLabel(summarizeActivity(message([toolCall('get_rule')])))).toBe('1 tool');
        expect(activityLabel(summarizeActivity(message([toolCall('run_sql')])))).toBe('1 query');
    });

    it('returns an empty label when there is nothing to report', () => {
        expect(activityLabel(summarizeActivity(message([{ type: 'text', text: 'hi' }])))).toBe('');
    });

    it('never contains an em dash', () => {
        const label = activityLabel(
            summarizeActivity(message([toolCall('list_rules'), toolCall('run_sql')], { inputTokens: 1, outputTokens: 1, costUSD: 1, durationMs: 1 })),
        );
        expect(label).not.toContain(EM_DASH);
    });
});
