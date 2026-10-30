import { fireEvent, render, screen } from '@testing-library/react';
import type { ChatMessage, MessagePart } from '@/lib/core/entity/assistant/conversation';
import { ActivityTimeline } from '@/component-library/features/assistant/ActivityTimeline';

const EM_DASH = String.fromCharCode(0x2014);

jest.mock('@/component-library/features/json/JSONViewer', () => ({
    JSONViewer: ({ value }: { value: string }) => <pre data-testid="json-viewer">{value}</pre>,
}));

const call = (toolName: string, extra: Partial<Extract<MessagePart, { type: 'tool-call' }>> = {}): MessagePart => ({
    type: 'tool-call',
    toolCallId: `${toolName}-id`,
    toolName,
    args: { state: 'Stuck' },
    policy: 'allow',
    status: 'done',
    durationMs: 1200,
    ...extra,
});

const parts: MessagePart[] = [
    { type: 'reasoning', text: 'Looking for stuck rules', durationMs: 4000 },
    call('find_tools'),
    call('list_rules', { result: { handle: 'rules_1', rowCount: 2 } }),
    call('get_rule'),
    call('run_sql', {
        args: { sql: 'SELECT state, count(*) AS n FROM rules_1 GROUP BY state' },
        result: { columns: ['state', 'n'], rows: [{ state: 'Stuck', n: 2 }], totalRows: 1 },
    }),
];
const usage = { inputTokens: 12_400, outputTokens: 800, costUSD: 0.04, durationMs: 9000 };

const turn = (turnParts: MessagePart[], turnUsage?: ChatMessage['usage']): ChatMessage => ({
    id: 'm1',
    conversationId: 'c1',
    role: 'assistant',
    parts: turnParts,
    createdAt: '2026-10-25T10:00:00.000Z',
    ...(turnUsage ? { usage: turnUsage } : {}),
});

describe('ActivityTimeline', () => {
    it('starts collapsed in compact mode with the summary line', () => {
        render(<ActivityTimeline message={turn(parts, usage)} detail="compact" />);
        const toggle = screen.getByRole('button', { name: 'Thought 4s · 3 tools · 1 query · 12.4k / 800 tok · $0.04' });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByTestId('json-viewer')).not.toBeInTheDocument();
    });

    it('expands into reasoning, tool calls and the SQL result', () => {
        render(<ActivityTimeline message={turn(parts, usage)} detail="compact" />);
        fireEvent.click(screen.getByRole('button', { expanded: false }));
        expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();
        expect(screen.getByText('Looking for stuck rules')).toBeInTheDocument();
        expect(screen.getAllByText('list_rules').length).toBeGreaterThan(0);
        expect(screen.getAllByText('1.2 s')).toHaveLength(4);
        expect(screen.getByText('SELECT state, count(*) AS n FROM rules_1 GROUP BY state')).toBeInTheDocument();
        expect(screen.getByTestId('assistant-result-table')).toHaveTextContent('Stuck');
        expect(screen.getAllByTestId('json-viewer').some(node => node.textContent?.includes('rules_1'))).toBe(true);
    });

    it('starts expanded in verbose mode', () => {
        render(<ActivityTimeline message={turn(parts, usage)} detail="verbose" />);
        expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();
    });

    it('keeps tool errors visible while collapsed', () => {
        render(
            <ActivityTimeline
                message={turn([
                    call('list_rules', { status: 'error', error: { error: 'session_expired', message: 'Your WebUI session has expired.' } }),
                ])}
                detail="compact"
            />,
        );
        expect(screen.getByRole('alert')).toHaveTextContent('list_rules failed: Your WebUI session has expired.');
    });

    it('lets the caller render live SQL results', () => {
        render(
            <ActivityTimeline message={turn(parts, usage)} detail="verbose" renderSqlResult={entry => <div data-testid="live">{entry.sql}</div>} />,
        );
        expect(screen.getByTestId('live')).toHaveTextContent('FROM rules_1');
        expect(screen.queryByTestId('assistant-result-table')).not.toBeInTheDocument();
    });

    it('renders nothing for a turn without activity', () => {
        const { container } = render(<ActivityTimeline message={turn([{ type: 'text', text: 'hi' }])} detail="compact" />);
        expect(container).toBeEmptyDOMElement();
    });

    it('labels a call whose arguments failed validation', () => {
        render(
            <ActivityTimeline
                message={turn([
                    call('list_rules', {
                        args: { __rucio_invalid_args: { message: 'bad', received: {} } },
                        status: 'error',
                        error: { error: 'invalid_args', message: 'bad' },
                    }),
                ])}
                detail="verbose"
            />,
        );
        expect(screen.getByText('Run list_rules (invalid arguments)')).toBeInTheDocument();
    });

    it('shows "Rows not stored" for a reopened run_sql result', () => {
        const stored = { columns: ['state', 'n'], totalRows: 7, rowsShown: 2, savedAs: 'by_state', rowsOmitted: true };
        render(<ActivityTimeline message={turn([call('run_sql', { args: { sql: 'SELECT 1' }, result: stored })])} detail="verbose" />);
        expect(screen.getByText(/Rows not stored/)).toBeInTheDocument();
        expect(screen.queryByTestId('assistant-result-table')).not.toBeInTheDocument();
    });

    it('hands a stored result to renderSqlResult with its columns and totals', () => {
        const stored = { columns: ['a'], totalRows: 7, savedAs: 'by_state', rowsOmitted: true as const };
        const seen: unknown[] = [];
        render(
            <ActivityTimeline
                message={turn([call('run_sql', { args: { sql: 'SELECT 1' }, result: stored })])}
                detail="verbose"
                renderSqlResult={entry => {
                    seen.push(entry);
                    return null;
                }}
            />,
        );
        expect(seen[0]).toMatchObject({ saveAs: 'by_state', result: { columns: ['a'], totalRows: 7, rowsOmitted: true } });
    });

    it('has no em dash in its copy', () => {
        const { container } = render(<ActivityTimeline message={turn(parts, usage)} detail="verbose" />);
        expect(container.textContent).not.toContain(EM_DASH);
    });
});
