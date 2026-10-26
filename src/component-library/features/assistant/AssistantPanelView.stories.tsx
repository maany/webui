import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { AssistantPanelView } from './AssistantPanelView';
import type { ChatMessage, Conversation } from '@/lib/core/entity/assistant/conversation';
import { EMPTY_USAGE_TOTALS } from '@/lib/core/entity/assistant/usage';
import { STEP_LIMIT_NOTICE } from '@/lib/infrastructure/assistant/message-reducer';

const conversation: Conversation = {
    id: 'c1',
    accountKey: 'root@def',
    title: 'Stuck rules on CERN-PROD',
    createdAt: '2026-10-25T10:00:00.000Z',
    updatedAt: '2026-10-25T10:05:00.000Z',
    providerId: 'operator',
    model: 'claude-sonnet-5-5',
    usage: EMPTY_USAGE_TOTALS,
    conversationAllow: [],
    handles: [],
};

const messages: ChatMessage[] = [
    {
        id: 'u1',
        conversationId: 'c1',
        role: 'user',
        createdAt: '2026-10-25T10:00:00.000Z',
        parts: [
            { type: 'text', text: 'How many of my rules are stuck, by RSE?' },
            { type: 'page-context', context: { route: '/rules', params: { state: 'STUCK' }, title: 'Rules', accountKey: 'root@def' } },
        ],
    },
    {
        id: 'a1',
        conversationId: 'c1',
        role: 'assistant',
        createdAt: '2026-10-25T10:00:05.000Z',
        usage: { inputTokens: 12_400, outputTokens: 800, costUSD: 0.04, durationMs: 6000 },
        parts: [
            { type: 'reasoning', text: 'List the stuck rules, then group by RSE expression.', durationMs: 4000 },
            {
                type: 'tool-call',
                toolCallId: 't1',
                toolName: 'list_rules',
                args: { state: 'STUCK' },
                policy: 'allow',
                status: 'done',
                durationMs: 640,
            },
            {
                type: 'text',
                text: 'You have **5** stuck rules:\n\n| RSE | Rules |\n|---|---|\n| CERN-PROD | 3 |\n| BNL-OSG2 | 2 |\n\nSee [rule 1234](/rule/1234) for the oldest one.',
            },
        ],
    },
];

const meta: Meta<typeof AssistantPanelView> = {
    title: 'Features/Assistant/AssistantPanelView',
    component: AssistantPanelView,
    parameters: { layout: 'fullscreen' },
    args: {
        state: 'open',
        isMobile: false,
        width: 420,
        status: 'idle',
        conversation,
        conversations: [conversation],
        messages,
        contextFraction: 0.41,
        contextWindow: 200_000,
        persistent: true,
        detail: 'compact',
        pageContext: { route: '/rules', params: {}, title: 'Rules', accountKey: 'root@def' },
        onResize: fn(),
        onSend: fn(),
        onStop: fn(),
        onRetry: fn(),
        onContinue: fn(),
        onNewChat: fn(),
        onOpenConversation: fn(),
        onDeleteConversation: fn(),
        onClose: fn(),
        onRestore: fn(),
    },
};

export default meta;
type Story = StoryObj<typeof AssistantPanelView>;

export const WithConversation: Story = {};
export const Empty: Story = { args: { conversation: undefined, messages: [], contextFraction: null } };
export const Streaming: Story = { args: { status: 'streaming' } };
export const Verbose: Story = { args: { detail: 'verbose' } };
export const ProviderError: Story = {
    args: {
        status: 'error',
        error: 'Rucio bot could not reach the provider. Check the base URL, CORS settings and that the server is running, then use Test connection in settings.',
    },
};
export const StepLimit: Story = {
    args: {
        messages: [
            ...messages,
            {
                id: 'a2',
                conversationId: 'c1',
                role: 'assistant',
                createdAt: 'x',
                parts: [{ type: 'notice', level: 'warning', text: STEP_LIMIT_NOTICE }],
            },
        ],
    },
};
export const HistoryNotSaved: Story = { args: { persistent: false } };
export const Mobile: Story = { args: { isMobile: true }, parameters: { viewport: { defaultViewport: 'mobile1' } } };
export const MinimizedBubble: Story = { args: { isMobile: true, state: 'minimized' } };
