import type { Meta, StoryObj } from '@storybook/nextjs';
import { BYOK_PROVIDER_KINDS } from '@/lib/core/entity/assistant/provider-config';
import { ProviderFormDialog } from './ProviderFormDialog';

const meta: Meta<typeof ProviderFormDialog> = {
    title: 'Features/Assistant/ProviderFormDialog',
    component: ProviderFormDialog,
    parameters: { layout: 'centered' },
    tags: ['autodocs'],
    args: {
        allowedKinds: [...BYOK_PROVIDER_KINDS],
        onSave: () => {},
        onClose: () => {},
        newId: () => 'new-provider',
    },
};

export default meta;
type Story = StoryObj<typeof ProviderFormDialog>;

export const Add: Story = {};

export const Edit: Story = {
    args: {
        initial: { id: 'p-1', kind: 'anthropic', label: 'My Claude', apiKey: 'sk-ant-example', model: 'claude-sonnet-5-5' },
    },
};

export const OnlyOllamaAllowed: Story = {
    args: { allowedKinds: ['ollama'] },
};
