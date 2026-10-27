jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AssistantPanelView, type AssistantPanelViewProps } from '@/component-library/features/assistant/AssistantPanelView';
import type { ChatMessage } from '@/lib/core/entity/assistant/conversation';
import { STEP_LIMIT_NOTICE } from '@/lib/infrastructure/assistant/message-reducer';
import { OFF_TOPIC_MESSAGE, OFF_TOPIC_NOTICE } from '@/lib/infrastructure/assistant/runner-errors';
import { makeConversation } from 'test/fixtures/assistant-fixtures';

function props(overrides: Partial<AssistantPanelViewProps> = {}): AssistantPanelViewProps {
    return {
        state: 'open',
        isMobile: false,
        width: 420,
        onResize: jest.fn(),
        status: 'idle',
        conversations: [],
        messages: [],
        contextFraction: null,
        persistent: true,
        detail: 'compact',
        pageContext: { route: '/rules', params: {}, title: 'Rules', accountKey: 'root@def' },
        onSend: jest.fn(),
        onStop: jest.fn(),
        onRetry: jest.fn(),
        onContinue: jest.fn(),
        onNewChat: jest.fn(),
        onOpenConversation: jest.fn(),
        onDeleteConversation: jest.fn(),
        onClose: jest.fn(),
        onRestore: jest.fn(),
        ...overrides,
    };
}

const assistantMessage = (parts: ChatMessage['parts'], usage?: ChatMessage['usage']): ChatMessage => ({
    id: 'a1',
    conversationId: 'c1',
    role: 'assistant',
    parts,
    createdAt: 'x',
    ...(usage ? { usage } : {}),
});

describe('AssistantPanelView', () => {
    it('is a non-modal docked panel with header controls', () => {
        const p = props({ conversation: makeConversation('c1', 'root@def'), contextFraction: 0.41, contextWindow: 200_000 });
        render(<AssistantPanelView {...p} />);
        const panel = screen.getByRole('complementary', { name: 'Rucio bot' });
        expect(panel).toHaveStyle({ width: '420px' });
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByText('Conversation c1')).toBeInTheDocument();
        expect(screen.getByText('41% of 200.0k')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Rucio bot settings' })).toHaveAttribute('href', '/assistant/settings');
        fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
        expect(p.onNewChat).toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Close Rucio bot' }));
        expect(p.onClose).toHaveBeenCalled();
    });

    it('sends on Enter with the page context attached, or detached after removing the chip', () => {
        const p = props();
        render(<AssistantPanelView {...p} />);
        const box = screen.getByLabelText('Message Rucio bot');
        fireEvent.change(box, { target: { value: 'How many rules are stuck?' } });
        fireEvent.keyDown(box, { key: 'Enter' });
        expect(p.onSend).toHaveBeenCalledWith('How many rules are stuck?', true);
        fireEvent.click(screen.getByRole('button', { name: 'Do not attach this page' }));
        fireEvent.change(box, { target: { value: 'General question' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        expect(p.onSend).toHaveBeenLastCalledWith('General question', false);
        expect(screen.getByText('Page: Rules')).toBeInTheDocument();
    });

    it('shows Stop while streaming', () => {
        const p = props({ status: 'streaming' });
        render(<AssistantPanelView {...p} />);
        fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
        expect(p.onStop).toHaveBeenCalled();
    });

    it('renders markdown answers with a collapsed activity line', () => {
        render(
            <AssistantPanelView
                {...props({
                    messages: [
                        assistantMessage(
                            [
                                { type: 'reasoning', text: 'Counting rules.', durationMs: 4000 },
                                {
                                    type: 'tool-call',
                                    toolCallId: 't1',
                                    toolName: 'list_rules',
                                    args: {},
                                    policy: 'allow',
                                    status: 'done',
                                    durationMs: 120,
                                },
                                { type: 'text', text: '**3** rules are stuck.' },
                            ],
                            { inputTokens: 12_400, outputTokens: 800, costUSD: 0.04, durationMs: 5000 },
                        ),
                    ],
                })}
            />,
        );
        const line = screen.getByRole('button', { name: 'Thought 4s · 1 tool · 12.4k / 800 tok · $0.04' });
        expect(line).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('Counting rules.')).toBeNull();
        fireEvent.click(line);
        expect(screen.getByText('Counting rules.')).toBeInTheDocument();
        expect(screen.getByText('3').tagName).toBe('STRONG');
    });

    it('shows errors with Retry and the step limit with Continue', () => {
        const p = props({ status: 'error', error: 'The provider rejected the API key.' });
        const { rerender } = render(<AssistantPanelView {...p} />);
        expect(screen.getByRole('alert')).toHaveTextContent('The provider rejected the API key.');
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(p.onRetry).toHaveBeenCalled();
        const q = props({ messages: [assistantMessage([{ type: 'notice', level: 'warning', text: STEP_LIMIT_NOTICE }])] });
        rerender(<AssistantPanelView {...q} />);
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        expect(q.onContinue).toHaveBeenCalled();
    });

    it('shows the off-topic warn notice as a quiet info note under the reply', () => {
        render(
            <AssistantPanelView
                {...props({
                    messages: [
                        assistantMessage([
                            { type: 'text', text: 'Sure.' },
                            { type: 'notice', level: 'info', text: OFF_TOPIC_NOTICE },
                        ]),
                    ],
                })}
            />,
        );
        const notice = screen.getByText(OFF_TOPIC_NOTICE);
        expect(notice).not.toHaveAttribute('role', 'alert');
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('shows a blocked off-topic turn as an error with Retry and no session banner', () => {
        render(
            <AssistantPanelView
                {...props({
                    status: 'error',
                    error: OFF_TOPIC_MESSAGE,
                    messages: [assistantMessage([{ type: 'notice', level: 'error', text: OFF_TOPIC_MESSAGE }])],
                })}
            />,
        );
        expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
        expect(screen.getAllByText(OFF_TOPIC_MESSAGE).length).toBeGreaterThan(0);
        expect(screen.queryByText(/session/i)).toBeNull();
    });

    it('warns when history is not saved', () => {
        render(<AssistantPanelView {...props({ persistent: false })} />);
        expect(screen.getByText('History is not saved in this browser. Chats last until you close this tab.')).toBeInTheDocument();
    });

    it('is a full-screen sheet on mobile and a bubble when minimized', () => {
        const p = props({ isMobile: true });
        const { rerender } = render(<AssistantPanelView {...p} />);
        expect(screen.getByRole('complementary', { name: 'Rucio bot' }).className).toContain('inset-0');
        expect(screen.queryByRole('separator')).toBeNull();
        rerender(<AssistantPanelView {...p} state="minimized" />);
        expect(screen.queryByRole('complementary')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Rucio bot' }));
        expect(p.onRestore).toHaveBeenCalled();
    });

    it('resizes with the keyboard on desktop', () => {
        const p = props();
        render(<AssistantPanelView {...p} />);
        fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize Rucio bot panel' }), { key: 'ArrowLeft' });
        expect(p.onResize).toHaveBeenCalledWith(436);
    });

    it('shows one session banner above the composer and no link in the error block', () => {
        const { rerender } = render(<AssistantPanelView {...props({ status: 'error', error: 'Your session expired.', sessionExpired: true })} />);
        expect(screen.getAllByRole('link', { name: 'Log in again' })).toHaveLength(1);
        expect(screen.getByRole('link', { name: 'Log in again' })).toHaveAttribute('href', '/auth/login?expired=true&callbackUrl=%2Frules');
        rerender(<AssistantPanelView {...props({ status: 'error', error: 'Boom.' })} />);
        expect(screen.queryByRole('link', { name: 'Log in again' })).toBeNull();
    });

    it('shows the session banner when the latest turn has an expired-session tool error', () => {
        const message = assistantMessage([
            {
                type: 'tool-call',
                toolCallId: 't1',
                toolName: 'list_rules',
                args: {},
                policy: 'allow',
                status: 'error',
                error: { error: 'session_expired', message: 'x' },
            },
        ]);
        render(<AssistantPanelView {...props({ messages: [message] })} />);
        expect(screen.getAllByRole('link', { name: 'Log in again' })).toHaveLength(1);
    });

    it('reopens a stored conversation with a run_sql result without rows', () => {
        const message = assistantMessage([
            {
                type: 'tool-call',
                toolCallId: 't1',
                toolName: 'run_sql',
                args: { sql: 'SELECT 1' },
                policy: 'allow',
                status: 'done',
                result: { columns: ['n'], totalRows: 4, rowsOmitted: true },
            },
        ]);
        render(<AssistantPanelView {...props({ messages: [message], detail: 'verbose' })} />);
        expect(screen.getByText(/Rows not stored/)).toBeInTheDocument();
    });

    it('shows an inline message when deleting a chat fails and never rejects unhandled', async () => {
        const onDeleteConversation = jest.fn().mockRejectedValue(new Error('storage failed'));
        const conversation = makeConversation('c1', 'root@def');
        render(<AssistantPanelView {...props({ conversation, conversations: [conversation], onDeleteConversation })} />);
        fireEvent.click(screen.getByRole('button', { name: 'Chat history' }));
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: `Delete chat ${conversation.title}` }));
        });
        expect(onDeleteConversation).toHaveBeenCalledWith('c1');
        expect(screen.getByText('Could not delete this chat.')).toBeInTheDocument();
    });

    it('closes only the history menu on the first Escape and the panel on the second', () => {
        const conversation = makeConversation('c1', 'root@def');
        const p = props({ conversation, conversations: [conversation] });
        render(<AssistantPanelView {...p} />);
        fireEvent.click(screen.getByRole('button', { name: 'Chat history' }));
        fireEvent.keyDown(screen.getByRole('list', { name: 'Saved chats' }), { key: 'Escape' });
        expect(screen.queryByRole('list', { name: 'Saved chats' })).toBeNull();
        expect(p.onClose).not.toHaveBeenCalled();
        fireEvent.keyDown(screen.getByLabelText('Message Rucio bot'), { key: 'Escape' });
        expect(p.onClose).toHaveBeenCalledTimes(1);
    });

    it('does not close the panel on Escape while an IME composition is active', () => {
        const p = props();
        render(<AssistantPanelView {...p} />);
        fireEvent.keyDown(screen.getByLabelText('Message Rucio bot'), { key: 'Escape', isComposing: true });
        expect(p.onClose).not.toHaveBeenCalled();
    });

    it('clears the delete failure message when the history menu is reopened', async () => {
        const onDeleteConversation = jest.fn().mockRejectedValue(new Error('storage failed'));
        const conversation = makeConversation('c1', 'root@def');
        render(<AssistantPanelView {...props({ conversation, conversations: [conversation], onDeleteConversation })} />);
        const history = screen.getByRole('button', { name: 'Chat history' });
        fireEvent.click(history);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: `Delete chat ${conversation.title}` }));
        });
        expect(screen.getByText('Could not delete this chat.')).toBeInTheDocument();
        fireEvent.click(history);
        fireEvent.click(history);
        expect(screen.queryByText('Could not delete this chat.')).toBeNull();
    });

    it('describes the resize separator range', () => {
        render(<AssistantPanelView {...props()} />);
        const separator = screen.getByRole('separator', { name: 'Resize Rucio bot panel' });
        expect(separator).toHaveAttribute('aria-valuemin', '320');
        // The jsdom window is 1024 wide: 45% of it, floored.
        expect(separator).toHaveAttribute('aria-valuemax', '460');
        expect(separator).toHaveAttribute('aria-valuenow', '420');
    });

    it('removes drag listeners on pointercancel and on unmount', () => {
        const remove = jest.spyOn(window, 'removeEventListener');
        const { unmount } = render(<AssistantPanelView {...props()} />);
        const separator = screen.getByRole('separator', { name: 'Resize Rucio bot panel' });
        fireEvent.pointerDown(separator);
        fireEvent(window, new Event('pointercancel'));
        expect(remove.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining(['pointermove', 'pointerup', 'pointercancel']));
        remove.mockClear();
        fireEvent.pointerDown(separator);
        unmount();
        expect(remove.mock.calls.map(call => call[0])).toContain('pointermove');
        remove.mockRestore();
    });

    it('announces turn progress in a status region instead of making the history live', () => {
        const { container, rerender } = render(<AssistantPanelView {...props()} />);
        expect(container.querySelector('[aria-live="polite"]:not([role="status"])')).toBeNull();
        const region = screen.getByRole('status');
        expect(region).toHaveTextContent('');
        rerender(<AssistantPanelView {...props({ status: 'streaming' })} />);
        expect(region).toHaveTextContent('Rucio bot is responding');
        rerender(<AssistantPanelView {...props({ status: 'awaiting-approval' })} />);
        expect(region).toHaveTextContent('Rucio bot needs your approval');
        rerender(<AssistantPanelView {...props({ status: 'idle' })} />);
        expect(region).toHaveTextContent('Rucio bot finished responding');
        rerender(<AssistantPanelView {...props({ status: 'error', error: 'x' })} />);
        expect(region).toHaveTextContent('');
        expect(screen.getByRole('alert')).toHaveTextContent('x');
    });

    it('only auto-scrolls when the reader is near the bottom', () => {
        const scrollIntoView = jest.fn();
        window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
        const m = (id: string) => ({ ...assistantMessage([{ type: 'text', text: id }]), id });
        const { rerender } = render(<AssistantPanelView {...props({ messages: [m('a')] })} />);
        const scroller = screen.getByTestId('assistant-scroll');
        Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1000 });
        Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 300 });
        scroller.scrollTop = 100;
        fireEvent.scroll(scroller);
        scrollIntoView.mockClear();
        rerender(<AssistantPanelView {...props({ messages: [m('a'), m('b')] })} />);
        expect(scrollIntoView).not.toHaveBeenCalled();
        scroller.scrollTop = 650;
        fireEvent.scroll(scroller);
        rerender(<AssistantPanelView {...props({ messages: [m('a'), m('b'), m('c')] })} />);
        expect(scrollIntoView).toHaveBeenCalled();
    });

    describe('scroll to bottom', () => {
        const m = (id: string, role: 'user' | 'assistant' = 'assistant') => ({ ...assistantMessage([{ type: 'text', text: id }]), id, role });
        function scrolledUp(messages: ChatMessage[], conversationId = 'c1') {
            const scrollIntoView = jest.fn();
            window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
            const conversation = makeConversation(conversationId, 'root@def');
            const view = render(<AssistantPanelView {...props({ conversation, messages })} />);
            const scroller = screen.getByTestId('assistant-scroll');
            Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1000 });
            Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 300 });
            scroller.scrollTop = 100;
            fireEvent.scroll(scroller);
            scrollIntoView.mockClear();
            return { ...view, scrollIntoView };
        }

        it('scrolls down when the user sends a message while scrolled up', () => {
            const { rerender, scrollIntoView } = scrolledUp([m('a')]);
            const conversation = makeConversation('c1', 'root@def');
            rerender(<AssistantPanelView {...props({ conversation, messages: [m('a'), m('u', 'user')] })} />);
            expect(scrollIntoView).toHaveBeenCalled();
        });

        it('scrolls down when another conversation is opened', () => {
            const { rerender, scrollIntoView } = scrolledUp([m('a')]);
            const other = makeConversation('c2', 'root@def');
            rerender(<AssistantPanelView {...props({ conversation: other, messages: [m('b')] })} />);
            expect(scrollIntoView).toHaveBeenCalled();
        });
    });
});

describe('AssistantPanelView focus', () => {
    it('focuses the composer when the panel opens and again when restored from the bubble', () => {
        const { rerender } = render(<AssistantPanelView {...props({ state: 'minimized' })} />);
        rerender(<AssistantPanelView {...props({ state: 'open' })} />);
        expect(screen.getByRole('textbox', { name: 'Message Rucio bot' })).toHaveFocus();
    });
});
