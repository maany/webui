import { render, screen } from '@testing-library/react';
import type { ChatMessage } from '@/lib/core/entity/assistant/conversation';
import { SessionExpiredBanner } from '@/component-library/features/assistant/SessionExpiredBanner';

const turn = (error?: 'session_expired' | 'unauthorized' | 'timeout'): ChatMessage => ({
    id: 'm1',
    conversationId: 'c1',
    role: 'assistant',
    createdAt: '2026-10-25T10:00:00.000Z',
    parts: [
        {
            type: 'tool-call',
            toolCallId: 't1',
            toolName: 'list_rules',
            args: {},
            policy: 'allow',
            status: error ? 'error' : 'done',
            ...(error ? { error: { error, message: 'x' } } : {}),
        },
    ],
});

describe('SessionExpiredBanner', () => {
    it('links to the login page with the current path', () => {
        render(<SessionExpiredBanner messages={[turn('session_expired')]} pathname="/rule/abc" />);
        expect(screen.getByRole('alert')).toHaveTextContent('Your session has expired. Log in again to continue.');
        expect(screen.getByRole('link', { name: 'Log in again' })).toHaveAttribute('href', '/auth/login?expired=true&callbackUrl=%2Frule%2Fabc');
    });

    it('also covers unauthorized', () => {
        render(<SessionExpiredBanner messages={[turn('unauthorized')]} pathname="/" />);
        expect(screen.getByRole('link', { name: 'Log in again' })).toHaveAttribute('href', '/auth/login?expired=true&callbackUrl=%2F');
    });

    it('renders with forced=true and no failed call', () => {
        render(<SessionExpiredBanner messages={[]} pathname="/rules" forced />);
        expect(screen.getByRole('link', { name: 'Log in again' })).toHaveAttribute('href', '/auth/login?expired=true&callbackUrl=%2Frules');
    });

    it('renders nothing for other errors', () => {
        const { container } = render(<SessionExpiredBanner messages={[turn('timeout')]} pathname="/" />);
        expect(container).toBeEmptyDOMElement();
    });
});
