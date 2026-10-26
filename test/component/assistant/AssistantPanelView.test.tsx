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

    it('offers a login link when the session expired', () => {
        const { rerender } = render(<AssistantPanelView {...props({ status: 'error', error: 'Your session expired.', sessionExpired: true })} />);
        expect(screen.getByRole('link', { name: 'Log in again' })).toHaveAttribute('href', '/auth/login');
        rerender(<AssistantPanelView {...props({ status: 'error', error: 'Boom.' })} />);
        expect(screen.queryByRole('link', { name: 'Log in again' })).toBeNull();
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
});
