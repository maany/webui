jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { AssistantPanelView } from '@/component-library/features/assistant/AssistantPanelView';
import { StarterPrompts } from '@/component-library/features/assistant/StarterPrompts';

let mockPathname = '/rule/abc123';
jest.mock('next/navigation', () => ({ ...jest.requireActual('next/navigation'), usePathname: () => mockPathname }));

describe('StarterPrompts', () => {
    it('shows the prompts for the current page and sends the chosen one', () => {
        const onSelect = jest.fn();
        render(<StarterPrompts onSelect={onSelect} />);

        expect(screen.getByRole('group', { name: 'Suggested questions' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Why is this rule stuck?' }));
        expect(onSelect).toHaveBeenCalledWith('Why is this rule stuck?');
    });

    it('follows navigation', () => {
        mockPathname = '/rse/CERN-PROD';
        render(<StarterPrompts onSelect={jest.fn()} />);
        expect(screen.getByRole('button', { name: 'Summarise usage and quotas' })).toBeInTheDocument();
        mockPathname = '/rule/abc123';
    });

    it('disables the buttons while a turn is running', () => {
        render(<StarterPrompts onSelect={jest.fn()} disabled />);
        screen.getAllByRole('button').forEach(button => expect(button).toBeDisabled());
    });

    it('has no accessibility violations', async () => {
        const { container } = render(<StarterPrompts onSelect={jest.fn()} />);
        expect(await axe(container)).toHaveNoViolations();
    });

    it('fills the empty state slot of the panel while there are no messages', () => {
        const onSelect = jest.fn();
        render(
            <AssistantPanelView
                state="open"
                isMobile={false}
                width={420}
                onResize={jest.fn()}
                status="idle"
                conversations={[]}
                messages={[]}
                contextFraction={null}
                persistent
                detail="compact"
                onSend={jest.fn()}
                onStop={jest.fn()}
                onRetry={jest.fn()}
                onContinue={jest.fn()}
                onNewChat={jest.fn()}
                onOpenConversation={jest.fn()}
                onDeleteConversation={jest.fn()}
                onClose={jest.fn()}
                onRestore={jest.fn()}
                emptyState={<StarterPrompts onSelect={onSelect} />}
            />,
        );

        expect(screen.getByRole('group', { name: 'Suggested questions' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Why is this rule stuck?' }));
        expect(onSelect).toHaveBeenCalledWith('Why is this rule stuck?');
    });
});
