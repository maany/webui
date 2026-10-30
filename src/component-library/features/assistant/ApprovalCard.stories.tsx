import type { Meta, StoryObj } from '@storybook/react';
import { ApprovalCard } from './ApprovalCard';

const meta: Meta<typeof ApprovalCard> = {
    title: 'Features/Assistant/ApprovalCard',
    component: ApprovalCard,
    parameters: { layout: 'padded' },
    tags: ['autodocs'],
    args: {
        toolName: 'create_rule',
        summary: 'Create rule: 2 copies of data18:XYZ on tier=1, lifetime 30 days',
        risk: 'write',
        args: { dids: [{ scope: 'data18', name: 'XYZ' }], copies: 2, rse_expression: 'tier=1', lifetime_days: 30 },
        policyReason: 'Changes to Rucio need your approval by default.',
        allowConversationScope: false,
        onResolve: () => undefined,
    },
};

export default meta;
type Story = StoryObj<typeof ApprovalCard>;

export const PendingWrite: Story = {};

export const PendingWithConversationScope: Story = {
    args: { allowConversationScope: true, policyReason: 'Your settings ask before running this tool.' },
};

export const PendingHighRisk: Story = {
    args: {
        toolName: 'add_account_identity',
        risk: 'high',
        summary: 'Add USERPASS identity jdoe to account jdoe as default, with a password',
        args: { account: 'jdoe', identity: 'jdoe', authType: 'USERPASS', email: 'jdoe@example.org', password: 'not-shown', isDefault: true },
        sensitiveArgs: ['password'],
        policyReason: 'High-risk action. It always needs your approval.',
    },
};

export const InvalidArguments: Story = {
    args: {
        summary: 'Run create_rule (invalid arguments)',
        args: { copies: 'two' },
        invalidArgsMessage: 'copies: Invalid input: expected number, received string',
    },
};

export const Expired: Story = { args: { decision: 'expired' } };

export const Approved: Story = { args: { decision: 'approved' } };

export const Rejected: Story = { args: { decision: 'rejected' } };

export const Mobile: Story = {
    parameters: { viewport: { defaultViewport: 'mobile1' } },
    args: { allowConversationScope: true },
};
