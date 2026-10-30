import type { Meta, StoryObj } from '@storybook/react';
import type { ChatMessage, MessagePart } from '@/lib/core/entity/assistant/conversation';
import { ActivityTimeline } from './ActivityTimeline';

const turn = (turnParts: MessagePart[], usage?: ChatMessage['usage']): ChatMessage => ({
    id: 'story-turn',
    conversationId: 'story',
    role: 'assistant',
    parts: turnParts,
    createdAt: '2026-10-25T10:00:00.000Z',
    ...(usage ? { usage } : {}),
});

const parts: MessagePart[] = [
    { type: 'reasoning', text: 'The user wants stuck rules per RSE. Load the rule tools, list stuck rules, then group them.', durationMs: 4000 },
    {
        type: 'tool-call',
        toolCallId: 'c1',
        toolName: 'find_tools',
        args: { query: 'stuck rules' },
        policy: 'allow',
        status: 'done',
        durationMs: 3,
        result: { tools: [{ name: 'list_rules', domain: 'rules' }], note: 'These tools are loaded. Call them directly in your next step.' },
    },
    {
        type: 'tool-call',
        toolCallId: 'c2',
        toolName: 'list_rules',
        args: { state: 'Stuck' },
        policy: 'allow',
        status: 'done',
        durationMs: 2300,
        result: {
            handle: 'rules_1',
            rowCount: 16,
            truncated: false,
            columns: ['id', 'rse_expression', 'state'],
            sample: [{ id: 'a1', rse_expression: 'CERN-PROD', state: 'Stuck' }],
        },
    },
    {
        type: 'tool-call',
        toolCallId: 'c3',
        toolName: 'get_rule',
        args: { id: 'a1' },
        policy: 'allow',
        status: 'done',
        durationMs: 400,
        result: { id: 'a1', state: 'Stuck', locks_stuck_cnt: 3 },
    },
    {
        type: 'tool-call',
        toolCallId: 'c4',
        toolName: 'run_sql',
        args: { sql: 'SELECT rse_expression, count(*) AS n FROM rules_1 GROUP BY 1 ORDER BY n DESC' },
        policy: 'allow',
        status: 'done',
        durationMs: 12,
        result: {
            columns: ['rse_expression', 'n'],
            rows: [
                { rse_expression: 'CERN-PROD', n: 12 },
                { rse_expression: 'BNL-OSG2_DATADISK', n: 4 },
            ],
            totalRows: 2,
        },
    },
    { type: 'text', text: '12 stuck rules target CERN-PROD and 4 target BNL-OSG2_DATADISK.' },
];

const meta: Meta<typeof ActivityTimeline> = {
    title: 'Features/Assistant/ActivityTimeline',
    component: ActivityTimeline,
    parameters: { layout: 'centered' },
    tags: ['autodocs'],
    decorators: [
        Story => (
            <div className="w-[420px]">
                <Story />
            </div>
        ),
    ],
    args: { message: turn(parts, { inputTokens: 12_400, outputTokens: 800, costUSD: 0.04, durationMs: 9000 }), detail: 'compact' },
};

export default meta;
type Story = StoryObj<typeof ActivityTimeline>;

export const Compact: Story = {};

export const Verbose: Story = { args: { detail: 'verbose' } };

export const WithFailedTool: Story = {
    args: {
        message: turn([
            ...parts.slice(0, 2),
            {
                type: 'tool-call',
                toolCallId: 'c9',
                toolName: 'list_rules',
                args: {},
                policy: 'allow',
                status: 'error',
                error: { error: 'session_expired', message: 'Your WebUI session has expired. Ask the user to log in again, then retry.' },
            },
        ]),
    },
};

export const PartialStream: Story = {
    args: {
        detail: 'verbose',
        message: turn([
            {
                type: 'tool-call',
                toolCallId: 'c5',
                toolName: 'list_dids',
                args: { query: 'user.jdoe:*', type: 'All' },
                policy: 'allow',
                status: 'done',
                result: {
                    handle: 'dids_1',
                    rowCount: 812,
                    truncated: true,
                    columns: ['scope', 'name', 'did_type'],
                    sample: [],
                    error: { error: 'stream_error', message: 'Stream failed after 812 rows: Rucio timed out' },
                },
            },
        ]),
    },
};
