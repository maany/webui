import { fireEvent, render, screen, within } from '@testing-library/react';
import { ProviderFormDialog } from '@/component-library/features/assistant/settings/ProviderFormDialog';
import { BYOK_PROVIDER_KINDS, type ProviderConfig } from '@/lib/core/entity/assistant/provider-config';
import { DEFAULT_BASE_URLS } from '@/lib/infrastructure/assistant/provider-kinds';

const renderDialog = (props: Partial<React.ComponentProps<typeof ProviderFormDialog>> = {}) => {
    const onSave = jest.fn();
    const onClose = jest.fn();
    render(<ProviderFormDialog allowedKinds={[...BYOK_PROVIDER_KINDS]} onSave={onSave} onClose={onClose} newId={() => 'new-1'} {...props} />);
    const dialog = screen.getByRole('dialog');
    const type = (label: RegExp, value: string) => fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
    return { dialog, onSave, onClose, type };
};

describe('ProviderFormDialog', () => {
    it('uses a text input for the base URL so the inline error shows instead of native validation', () => {
        const { dialog } = renderDialog();
        const input = within(dialog).getByLabelText(/^Base URL/);
        expect(input).toHaveAttribute('type', 'text');
        expect(input).toHaveAttribute('inputmode', 'url');
    });

    it('masks the API key input', () => {
        const { dialog } = renderDialog();
        expect(within(dialog).getByLabelText(/^API key/)).toHaveAttribute('type', 'password');
    });

    it('derives the Ollama base URL hint from the default', () => {
        const { dialog } = renderDialog({ allowedKinds: ['ollama'] });
        expect(within(dialog).getByText(`Leave empty for ${DEFAULT_BASE_URLS.ollama}.`)).toBeInTheDocument();
    });

    it('saves a new Anthropic provider', () => {
        const { dialog, onSave, onClose, type } = renderDialog();
        fireEvent.click(within(dialog).getByRole('radio', { name: /^Anthropic/ }));
        type(/^Name/, 'My Claude');
        type(/^API key/, 'sk-ant-test');
        type(/^Model/, 'claude-sonnet-5-5');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save provider' }));
        expect(onSave).toHaveBeenCalledWith({
            id: 'new-1',
            kind: 'anthropic',
            label: 'My Claude',
            apiKey: 'sk-ant-test',
            model: 'claude-sonnet-5-5',
        });
        expect(onClose).toHaveBeenCalled();
    });

    it('shows inline errors and does not save an incomplete draft', () => {
        const { dialog, onSave } = renderDialog();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save provider' }));
        expect(within(dialog).getByText('Enter a name for this provider.')).toBeInTheDocument();
        expect(within(dialog).getByText('Enter a model id.')).toBeInTheDocument();
        expect(within(dialog).getByLabelText(/^Name/)).toHaveAttribute('aria-invalid', 'true');
        expect(onSave).not.toHaveBeenCalled();
    });

    it('offers only the kinds the operator allows', () => {
        const { dialog } = renderDialog({ allowedKinds: ['ollama'] });
        const radios = within(dialog).getAllByRole('radio');
        expect(radios).toHaveLength(1);
        expect(radios[0]).toHaveAccessibleName(/^Ollama/);
    });

    it('shows a disallowed kind of an existing provider as disabled', () => {
        const initial: ProviderConfig = { id: 'p-1', kind: 'anthropic', label: 'Old', apiKey: 'sk', model: 'claude-sonnet-5-5' };
        const { dialog } = renderDialog({ allowedKinds: ['ollama'], initial });
        expect(within(dialog).getByRole('radio', { name: /^Anthropic/ })).toBeDisabled();
    });

    it('warns that keys are stored in plain text', () => {
        const { dialog } = renderDialog();
        expect(within(dialog).getByText(/stored in plain text in this browser/)).toBeInTheDocument();
    });

    it('shows the context window of a known model', () => {
        const { dialog, type } = renderDialog();
        type(/^Model/, 'claude-haiku-4-5');
        expect(within(dialog).getByText('Known model, 200,000 token context.')).toBeInTheDocument();
    });

    it('edits an existing provider and keeps its id', () => {
        const initial: ProviderConfig = { id: 'p-1', kind: 'anthropic', label: 'Old', apiKey: 'sk', model: 'claude-sonnet-5-5' };
        const { dialog, onSave, type } = renderDialog({ initial });
        expect(within(dialog).getByRole('heading', { name: 'Edit provider' })).toBeInTheDocument();
        expect(within(dialog).getByLabelText(/^Name/)).toHaveValue('Old');
        type(/^Model/, 'claude-opus-5-5');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save provider' }));
        expect(onSave).toHaveBeenCalledWith({ ...initial, model: 'claude-opus-5-5' });
    });

    it('closes on cancel', () => {
        const { dialog, onClose } = renderDialog();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalled();
    });
});
