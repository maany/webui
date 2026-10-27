import type { ChatMessage } from '@/lib/core/entity/assistant/conversation';
import { toModelMessages } from '@/lib/infrastructure/assistant/tanstack-agent-runner';
import { transcriptForSummary } from '@/lib/infrastructure/assistant/system-prompt';
import { extractNewUserTurnText } from '@/lib/infrastructure/assistant/relay-scope';
import { OFF_TOPIC_MESSAGE } from '@/lib/infrastructure/assistant/runner-errors';

const user = (id: string, text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
    id,
    conversationId: 'c',
    role: 'user',
    parts: [{ type: 'text', text }],
    createdAt: 'x',
    ...extra,
});
const assistant = (id: string, parts: ChatMessage['parts']): ChatMessage => ({ id, conversationId: 'c', role: 'assistant', parts, createdAt: 'x' });

describe('blocked off-topic turns in history', () => {
    const history: ChatMessage[] = [
        user('u1', 'why is my rule stuck?'),
        assistant('a1', [{ type: 'text', text: 'Check the locks.' }]),
        user('u2', 'write an essay about my holiday', { offTopic: true }),
        assistant('a2', [{ type: 'notice', level: 'error', text: OFF_TOPIC_MESSAGE }]),
        user('u3', 'continue'),
    ];

    it('leaves the blocked user message and its notice-only reply out of the model history', () => {
        const messages = toModelMessages(history);
        expect(messages.map(message => message.role)).toEqual(['user', 'assistant', 'user']);
        expect(JSON.stringify(messages)).not.toContain('holiday');
    });

    it('leaves them out of the compaction transcript', () => {
        const transcript = transcriptForSummary(history);
        expect(transcript).not.toContain('holiday');
        expect(transcript).toContain('why is my rule stuck?');
        expect(transcript).toContain('continue');
    });

    it('keeps an unflagged user message', () => {
        expect(JSON.stringify(toModelMessages([user('u', 'write an essay')]))).toContain('essay');
    });
});

describe('Anthropic request shape of a new turn after a tool result', () => {
    async function formatted(messages: unknown[]) {
        const { createAnthropicChat } = await import('@tanstack/ai-anthropic');
        const adapter = createAnthropicChat('claude-sonnet-4-5' as never, 'key', { dangerouslyAllowBrowser: true }) as unknown as {
            formatMessages(messages: unknown[]): unknown[];
        };
        return JSON.stringify({ messages: adapter.formatMessages(messages) });
    }
    const toolRound = [
        { role: 'user', content: 'list rules' },
        { role: 'assistant', content: null, toolCalls: [{ id: 'c1', type: 'function', function: { name: 'list_rules', arguments: '{}' } }] },
        { role: 'tool', toolCallId: 'c1', content: '[]' },
    ];

    it('classifies the new turn the adapter merges behind the tool_result', async () => {
        const body = await formatted([...toolRound, { role: 'user', content: 'write me a poem' }]);
        expect(body).toContain('tool_result');
        expect(extractNewUserTurnText('anthropic', body)).toBe('write me a poem');
    });

    it('does not classify a pure tool continuation', async () => {
        expect(extractNewUserTurnText('anthropic', await formatted(toolRound))).toBeUndefined();
    });
});
