const mockSession: { current: { user: { rucioAccount: string; rucioVO: string } } | null } = {
    current: { user: { rucioAccount: 'root', rucioVO: 'def' } },
};
jest.mock('next-auth/react', () => ({
    useSession: () => ({ data: mockSession.current }),
}));
jest.mock('@/lib/infrastructure/assistant/indexeddb-conversation-repository', () => ({
    createConversationRepository: jest.fn(),
}));
jest.mock('@/lib/infrastructure/hooks/useAssistantShell', () => ({ useAssistantPanel: jest.fn() }));

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssistantStorageSection } from '@/component-library/features/assistant/settings/AssistantStorageSection';
import { InMemoryConversationRepository } from '@/lib/infrastructure/assistant/in-memory-conversation-repository';
import { createConversationRepository } from '@/lib/infrastructure/assistant/indexeddb-conversation-repository';
import { getDefaultAssistantSettings } from '@/lib/infrastructure/assistant/settings-storage';
import { useAssistantPanel } from '@/lib/infrastructure/hooks/useAssistantShell';
import { makeConversation } from 'test/fixtures/assistant-fixtures';

function setup(shellOverrides: Record<string, unknown> = {}) {
    mockSession.current = { user: { rucioAccount: 'root', rucioVO: 'def' } };
    const repository = new InMemoryConversationRepository();
    (createConversationRepository as jest.Mock).mockResolvedValue({ repository, persistent: true });
    const notifyStorageChanged = jest.fn();
    (useAssistantPanel as jest.Mock).mockReturnValue({ memoryControls: null, conversationControls: null, notifyStorageChanged, ...shellOverrides });
    return { repository, notifyStorageChanged };
}

async function seed(repository: InMemoryConversationRepository) {
    await repository.saveConversation(makeConversation('c1', 'root@def', '2026-10-24T08:00:00.000Z'));
    await repository.saveConversation(makeConversation('c2', 'root@def', '2026-10-23T08:00:00.000Z'));
}

const renderSection = () => render(<AssistantStorageSection settings={getDefaultAssistantSettings()} onUpdate={jest.fn()} />);

describe('AssistantStorageSection', () => {
    it('shows the memory-only notice once the repository reports lost persistence, and unsubscribes on unmount', async () => {
        const { repository } = setup();
        let lost: () => void = () => undefined;
        const unsubscribe = jest.fn();
        (repository as unknown as { onPersistenceLost: (listener: () => void) => () => void }).onPersistenceLost = listener => {
            lost = listener;
            return unsubscribe;
        };
        const { unmount } = renderSection();
        await screen.findByText(/chats? for this account/);
        expect(screen.queryByText(/History is kept in memory only/)).not.toBeInTheDocument();
        act(() => lost());
        expect(await screen.findByText(/History is kept in memory only/)).toBeInTheDocument();
        unmount();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('deletes through the repository when the assistant is not mounted', async () => {
        const { repository, notifyStorageChanged } = setup();
        await seed(repository);
        renderSection();
        fireEvent.click(await screen.findByRole('button', { name: 'Delete Conversation c1' }));
        await waitFor(() => expect(notifyStorageChanged).toHaveBeenCalled());
        expect(await repository.getConversation('c1')).toBeUndefined();
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete Conversation c1' })).not.toBeInTheDocument());
    });

    it('uses the registered conversation controls when present', async () => {
        const conversationControls = {
            deleteConversation: jest.fn().mockResolvedValue(undefined),
            deleteAll: jest.fn().mockResolvedValue(undefined),
        };
        const { repository, notifyStorageChanged } = setup({ conversationControls });
        await seed(repository);
        const deleteSpy = jest.spyOn(repository, 'deleteConversation');
        const deleteAllSpy = jest.spyOn(repository, 'deleteAll');
        renderSection();
        fireEvent.click(await screen.findByRole('button', { name: 'Delete Conversation c1' }));
        await waitFor(() => expect(conversationControls.deleteConversation).toHaveBeenCalledWith('c1'));
        fireEvent.click(screen.getByRole('button', { name: 'Delete all chats' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete all' }));
        await waitFor(() => expect(conversationControls.deleteAll).toHaveBeenCalled());
        await waitFor(() => expect(notifyStorageChanged).toHaveBeenCalledTimes(2));
        expect(deleteSpy).not.toHaveBeenCalled();
        expect(deleteAllSpy).not.toHaveBeenCalled();
    });

    it('shows an inline message when deleting one chat fails', async () => {
        const conversationControls = { deleteConversation: jest.fn().mockRejectedValue(new Error('disk full')), deleteAll: jest.fn() };
        const { repository, notifyStorageChanged } = setup({ conversationControls });
        await seed(repository);
        renderSection();
        fireEvent.click(await screen.findByRole('button', { name: 'Delete Conversation c1' }));
        expect(await screen.findByText('Could not delete this chat.')).toBeInTheDocument();
        expect(notifyStorageChanged).not.toHaveBeenCalled();
    });

    it('shows an inline message when deleting all chats fails', async () => {
        const { repository } = setup();
        await seed(repository);
        jest.spyOn(repository, 'deleteAll').mockRejectedValueOnce(new Error('disk full'));
        renderSection();
        fireEvent.click(await screen.findByRole('button', { name: 'Delete all chats' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete all' }));
        expect(await screen.findByText('Could not delete chats.')).toBeInTheDocument();
    });

    it('frees memory through the registered controls', async () => {
        const memoryControls = { memoryBytes: jest.fn().mockResolvedValue(2048), freeMemory: jest.fn().mockResolvedValue(undefined) };
        setup({ memoryControls });
        renderSection();
        expect(await screen.findByText('Data tables use 2.0 kB.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Free memory now' }));
        await waitFor(() => expect(memoryControls.freeMemory).toHaveBeenCalled());
    });

    it('leaves the list intact and does not notify when a delete fails', async () => {
        const { repository, notifyStorageChanged } = setup();
        await seed(repository);
        jest.spyOn(repository, 'deleteConversation').mockRejectedValueOnce(new Error('disk full'));
        renderSection();
        fireEvent.click(await screen.findByRole('button', { name: 'Delete Conversation c1' }));
        expect(await screen.findByText('Could not delete this chat.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete Conversation c1' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete Conversation c2' })).toBeInTheDocument();
        expect(notifyStorageChanged).not.toHaveBeenCalled();
    });

    it('shows an error when freeing memory fails', async () => {
        const memoryControls = { memoryBytes: jest.fn().mockResolvedValue(2048), freeMemory: jest.fn().mockRejectedValue(new Error('worker gone')) };
        setup({ memoryControls });
        renderSection();
        await screen.findByText('Data tables use 2.0 kB.');
        fireEvent.click(screen.getByRole('button', { name: 'Free memory now' }));
        expect(await screen.findByText('Could not free memory.')).toBeInTheDocument();
    });

    it('shows an error instead of rejecting when the chats cannot be loaded', async () => {
        const { repository } = setup();
        jest.spyOn(repository, 'listConversations').mockRejectedValue(new Error('db closed'));
        renderSection();
        expect(await screen.findByText('Could not load saved chats.')).toBeInTheDocument();
    });

    it('shows an error instead of rejecting when the repository cannot be opened', async () => {
        setup();
        (createConversationRepository as jest.Mock).mockRejectedValue(new Error('blocked'));
        renderSection();
        expect(await screen.findByText('Could not load saved chats.')).toBeInTheDocument();
    });

    it('shows an error when the reload after a delete fails', async () => {
        const { repository } = setup();
        await seed(repository);
        renderSection();
        fireEvent.click(await screen.findByRole('button', { name: 'Delete Conversation c1' }));
        jest.spyOn(repository, 'listConversations').mockRejectedValue(new Error('db closed'));
        expect(await screen.findByText('Could not load saved chats.')).toBeInTheDocument();
    });

    it('clears the list when the account signs out', async () => {
        const { repository } = setup();
        await seed(repository);
        const { rerender } = renderSection();
        await screen.findByRole('button', { name: 'Delete Conversation c1' });
        mockSession.current = null;
        rerender(<AssistantStorageSection settings={getDefaultAssistantSettings()} onUpdate={jest.fn()} />);
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete Conversation c1' })).not.toBeInTheDocument());
    });
});
