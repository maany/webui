import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { AssistantStorageView } from './AssistantStorageSection';
import { EMPTY_USAGE_TOTALS } from '@/lib/core/entity/assistant/usage';

const conversation = (id: string, title: string, updatedAt: string) => ({
    id,
    accountKey: 'root@def',
    title,
    createdAt: updatedAt,
    updatedAt,
    providerId: 'operator',
    model: 'claude-sonnet-5-5',
    usage: EMPTY_USAGE_TOTALS,
    conversationAllow: [],
    handles: [],
});

const meta: Meta<typeof AssistantStorageView> = {
    title: 'Features/Assistant/AssistantStorageView',
    component: AssistantStorageView,
    args: {
        conversations: [
            conversation('c1', 'Stuck rules on CERN-PROD', '2026-10-24T08:00:00.000Z'),
            conversation('c2', 'Quota for atlas', '2026-10-20T08:00:00.000Z'),
        ],
        sizes: { c1: 48_000, c2: 12_000 },
        totalBytes: 60_000,
        browserUsage: { usage: 3_400_000, quota: 120_000_000 },
        memoryBytes: null,
        persistent: true,
        retention: { maxAgeDays: 30, maxTotalMB: 50, clearOnLogout: false },
        onRetentionChange: fn(),
        onExport: fn(),
        onDelete: fn(),
        onDeleteAll: fn(),
        onFreeMemory: fn(),
    },
};

export default meta;
type Story = StoryObj<typeof AssistantStorageView>;

export const Default: Story = {};
export const NoChats: Story = { args: { conversations: [], sizes: {}, totalBytes: 0 } };
export const MemoryInUse: Story = { args: { memoryBytes: 24_000_000 } };
export const NotPersistent: Story = { args: { persistent: false } };
export const OtherAccounts: Story = {
    args: {
        otherAccounts: [
            { accountKey: 'jdoe@def', conversations: 3, bytes: 84_000 },
            { accountKey: 'mlassnig@atlas', conversations: 1, bytes: 9_500 },
        ],
        onDeleteAccount: fn(),
        onDeleteAllAccounts: fn(),
    },
};
