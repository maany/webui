import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HistoryMenu } from '@/component-library/features/assistant/HistoryMenu';
import { makeConversation } from 'test/fixtures/assistant-fixtures';

function renderMenu(onRename = jest.fn().mockResolvedValue(undefined)) {
    const onOpen = jest.fn();
    const onClose = jest.fn();
    render(
        <div
            onKeyDown={event => {
                if (event.key === 'Escape' && !event.defaultPrevented) onClose();
            }}
        >
            <HistoryMenu
                conversations={[makeConversation('c1', 'root@def')]}
                currentId="c1"
                onOpen={onOpen}
                onDelete={jest.fn()}
                onRename={onRename}
            />
        </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Chat history' }));
    return { onRename, onOpen, onClose };
}

describe('HistoryMenu rename', () => {
    it('turns the title into an input and saves on Enter', async () => {
        const { onRename } = renderMenu();
        fireEvent.click(screen.getByRole('button', { name: 'Rename Conversation c1' }));
        const input = screen.getByRole('textbox', { name: 'Chat title' });
        expect(input).toHaveFocus();
        expect(input).toHaveValue('Conversation c1');
        fireEvent.change(input, { target: { value: 'Stuck rules' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(onRename).toHaveBeenCalledWith('c1', 'Stuck rules'));
        await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Chat title' })).not.toBeInTheDocument());
        expect(screen.getByRole('button', { name: 'Rename Conversation c1' })).toHaveFocus();
    });

    it('saves on blur', async () => {
        const { onRename } = renderMenu();
        fireEvent.click(screen.getByRole('button', { name: 'Rename Conversation c1' }));
        const input = screen.getByRole('textbox', { name: 'Chat title' });
        fireEvent.change(input, { target: { value: 'Blurred' } });
        fireEvent.blur(input);
        await waitFor(() => expect(onRename).toHaveBeenCalledWith('c1', 'Blurred'));
    });

    it('cancels on Escape without saving, keeps the popover and the panel open, and refocuses the pencil', () => {
        const { onRename, onClose } = renderMenu();
        fireEvent.click(screen.getByRole('button', { name: 'Rename Conversation c1' }));
        const input = screen.getByRole('textbox', { name: 'Chat title' });
        fireEvent.change(input, { target: { value: 'Nope' } });
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(onRename).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.queryByRole('textbox', { name: 'Chat title' })).not.toBeInTheDocument();
        expect(screen.getByRole('list', { name: 'Saved chats' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Rename Conversation c1' })).toHaveFocus();
    });

    it('does not save an unchanged title', () => {
        const { onRename } = renderMenu();
        fireEvent.click(screen.getByRole('button', { name: 'Rename Conversation c1' }));
        fireEvent.keyDown(screen.getByRole('textbox', { name: 'Chat title' }), { key: 'Enter' });
        expect(onRename).not.toHaveBeenCalled();
    });

    it('shows an inline error and keeps editing when saving fails', async () => {
        const { onRename } = renderMenu(jest.fn().mockRejectedValue(new Error('disk full')));
        fireEvent.click(screen.getByRole('button', { name: 'Rename Conversation c1' }));
        const input = screen.getByRole('textbox', { name: 'Chat title' });
        fireEvent.change(input, { target: { value: 'Fails' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(await screen.findByRole('alert')).toHaveTextContent('Could not rename this chat.');
        expect(onRename).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('textbox', { name: 'Chat title' })).toBeInTheDocument();
    });

    it('shows the error for an empty title without calling rename', async () => {
        const { onRename } = renderMenu();
        fireEvent.click(screen.getByRole('button', { name: 'Rename Conversation c1' }));
        const input = screen.getByRole('textbox', { name: 'Chat title' });
        fireEvent.change(input, { target: { value: '   ' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(await screen.findByRole('alert')).toHaveTextContent('Could not rename this chat.');
        expect(onRename).not.toHaveBeenCalled();
    });
});
