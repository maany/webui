import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { ApprovalCard, type ApprovalCardProps } from '@/component-library/features/assistant/ApprovalCard';

const EM_DASH = String.fromCharCode(0x2014);
const noEmDash = () => expect(document.body.textContent).not.toContain(EM_DASH);

const base: ApprovalCardProps = {
    toolName: 'create_rule',
    summary: 'Create rule: 2 copies of data18:XYZ on tier=1, lifetime 30 days',
    risk: 'write',
    args: { dids: [{ scope: 'data18', name: 'XYZ' }], copies: 2, rse_expression: 'tier=1', lifetime_days: 30 },
    policyReason: 'Changes to Rucio need your approval by default.',
    allowConversationScope: false,
};

describe('ApprovalCard', () => {
    beforeAll(() => {
        Element.prototype.scrollIntoView = jest.fn();
    });

    it('shows the summary, the reason and the two actions, never collapsed', () => {
        render(<ApprovalCard {...base} onResolve={jest.fn()} />);
        expect(screen.getByRole('heading', { name: 'Action needs approval' })).toBeInTheDocument();
        expect(screen.getByText(base.summary)).toBeInTheDocument();
        expect(screen.getByText(base.policyReason as string)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
        noEmDash();
    });

    it('puts Approve first in reading order and scrolls itself into view', () => {
        render(<ApprovalCard {...base} onResolve={jest.fn()} />);
        const buttons = screen.getAllByRole('button').map(button => button.textContent);
        expect(buttons.indexOf('Approve')).toBeLessThan(buttons.indexOf('Reject'));
        expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    });

    it('approves once and ignores a second click', () => {
        const onResolve = jest.fn();
        render(<ApprovalCard {...base} onResolve={onResolve} />);
        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
        expect(onResolve).toHaveBeenCalledTimes(1);
        expect(onResolve).toHaveBeenCalledWith('approved', 'once');
        expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
    });

    it('approves for the conversation when the box is checked', () => {
        const onResolve = jest.fn();
        render(<ApprovalCard {...base} allowConversationScope onResolve={onResolve} />);
        fireEvent.click(screen.getByRole('checkbox', { name: 'Allow for this conversation' }));
        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
        expect(onResolve).toHaveBeenCalledWith('approved', 'conversation');
    });

    it('a rejection is always once', () => {
        const onResolve = jest.fn();
        render(<ApprovalCard {...base} allowConversationScope onResolve={onResolve} />);
        fireEvent.click(screen.getByRole('checkbox', { name: 'Allow for this conversation' }));
        fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
        expect(onResolve).toHaveBeenCalledWith('rejected', 'once');
    });

    it('marks high-risk actions', () => {
        render(<ApprovalCard {...base} risk="high" toolName="delete_account" summary="Delete account jdoe" onResolve={jest.fn()} />);
        expect(screen.getByRole('heading', { name: 'High-risk action needs approval' })).toBeInTheDocument();
    });

    it('keeps raw args collapsed until asked and masks sensitive keys', () => {
        render(
            <ApprovalCard
                {...base}
                risk="high"
                toolName="add_account_identity"
                summary="Add USERPASS identity jdoe to account jdoe, with a password"
                args={{ account: 'jdoe', identity: 'jdoe', authType: 'USERPASS', email: 'jdoe@example.org', password: 's3cret-Pass' }}
                sensitiveArgs={['password']}
                onResolve={jest.fn()}
            />,
        );
        expect(document.body.textContent).not.toContain('jdoe@example.org');
        fireEvent.click(screen.getByRole('button', { name: 'Show arguments' }));
        expect(document.body.textContent).toContain('jdoe@example.org');
        expect(document.body.textContent).toContain('[hidden]');
        expect(document.body.textContent).not.toContain('s3cret');
    });

    it('renders an expired card without actions', () => {
        render(<ApprovalCard {...base} decision="expired" />);
        expect(screen.getByText('Expired')).toBeInTheDocument();
        expect(screen.getByText('Nobody approved this action before the chat was closed. It did not run.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
        noEmDash();
    });

    it('renders approved and rejected decisions', () => {
        const { rerender } = render(<ApprovalCard {...base} decision="approved" />);
        expect(screen.getByText('Approved')).toBeInTheDocument();
        rerender(<ApprovalCard {...base} decision="rejected" />);
        expect(screen.getByText('Rejected')).toBeInTheDocument();
        expect(screen.getByText('You rejected this action. It did not run.')).toBeInTheDocument();
    });

    it('masks sensitive keys on a decided card too', () => {
        const identity = { account: 'jdoe', identity: 'jdoe', authType: 'USERPASS', password: 's3cret-Pass' };
        for (const decision of ['approved', 'rejected', 'expired'] as const) {
            const { unmount } = render(
                <ApprovalCard
                    {...base}
                    risk="high"
                    toolName="add_account_identity"
                    args={identity}
                    sensitiveArgs={['password']}
                    decision={decision}
                />,
            );
            fireEvent.click(screen.getByRole('button', { name: 'Show arguments' }));
            expect(document.body.textContent).toContain('[hidden]');
            expect(document.body.textContent).not.toContain('s3cret');
            unmount();
        }
    });

    describe('invalid arguments', () => {
        const invalid = {
            ...base,
            summary: 'Run add_account_identity (invalid arguments)',
            toolName: 'add_account_identity',
            risk: 'high' as const,
            args: { account: 'jdoe', password: 's3cret-Pass' },
            sensitiveArgs: ['password'],
            invalidArgsMessage: 'authType: Required',
            allowConversationScope: true,
        };

        it('offers only Reject, shows the message and masks the received args', () => {
            const onResolve = jest.fn();
            render(<ApprovalCard {...invalid} onResolve={onResolve} />);
            expect(screen.getByRole('heading', { name: 'Rucio bot sent invalid arguments' })).toBeInTheDocument();
            expect(screen.getByText('authType: Required')).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
            expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'Show arguments' }));
            expect(document.body.textContent).toContain('[hidden]');
            expect(document.body.textContent).not.toContain('s3cret');
            fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
            expect(onResolve).toHaveBeenCalledWith('rejected', 'once');
            noEmDash();
        });

        it('is read-only once decided', () => {
            render(<ApprovalCard {...invalid} decision="expired" />);
            expect(screen.getByText('Run add_account_identity (invalid arguments)')).toBeInTheDocument();
            expect(screen.getByText('Expired')).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
        });
    });

    it('has no accessibility violations', async () => {
        const { container } = render(<ApprovalCard {...base} allowConversationScope onResolve={jest.fn()} />);
        expect(await axe(container)).toHaveNoViolations();
    });
});
