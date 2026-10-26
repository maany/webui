const mockSession: { current: { user: { rucioAccount: string; rucioVO: string } } | null } = {
    current: { user: { rucioAccount: 'root', rucioVO: 'def' } },
};
jest.mock('next-auth/react', () => ({
    useSession: () => ({ data: mockSession.current }),
}));
jest.mock('@/lib/infrastructure/assistant/indexeddb-conversation-repository', () => ({
    createConversationRepository: jest.fn(),
    deleteAssistantDatabase: jest.fn(),
}));
jest.mock('@/lib/infrastructure/hooks/useAssistantShell', () => ({ useAssistantPanel: jest.fn() }));

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssistantStorageSection } from '@/component-library/features/assistant/settings/AssistantStorageSection';
import { InMemoryConversationRepository } from '@/lib/infrastructure/assistant/in-memory-conversation-repository';
import { createConversationRepository, deleteAssistantDatabase } from '@/lib/infrastructure/assistant/indexeddb-conversation-repository';
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

    describe('other accounts', () => {
        async function seedOthers(repository: InMemoryConversationRepository) {
            await seed(repository);
            await repository.saveConversation(makeConversation('b1', 'bob@def', '2026-10-22T08:00:00.000Z'));
            await repository.saveConversation(makeConversation('b2', 'bob@def', '2026-10-21T08:00:00.000Z'));
            await repository.saveConversation(makeConversation('k1', 'carol@atlas', '2026-10-20T08:00:00.000Z'));
        }

        it('lists the other accounts and leaves the current account out', async () => {
            const { repository } = setup();
            await seedOthers(repository);
            renderSection();
            expect(await screen.findByText('bob@def')).toBeInTheDocument();
            expect(screen.getByText('carol@atlas')).toBeInTheDocument();
            expect(screen.getByText(/^2 chats, /)).toBeInTheDocument();
            expect(screen.queryByText('root@def')).not.toBeInTheDocument();
        });

        it('hides the section when only the current account has chats', async () => {
            const { repository } = setup();
            await seed(repository);
            renderSection();
            await screen.findByText(/chats? for this account/);
            expect(screen.queryByText('Other accounts in this browser')).not.toBeInTheDocument();
        });

        it('deletes one other account through the repository, never the controller', async () => {
            const conversationControls = { deleteConversation: jest.fn(), deleteAll: jest.fn() };
            const { repository, notifyStorageChanged } = setup({ conversationControls });
            await seedOthers(repository);
            renderSection();
            fireEvent.click(await screen.findByRole('button', { name: 'Delete chats of bob@def' }));
            fireEvent.click(screen.getByRole('button', { name: 'Confirm delete of bob@def' }));
            await waitFor(() => expect(screen.queryByText('bob@def')).not.toBeInTheDocument());
            expect(notifyStorageChanged).toHaveBeenCalled();
            expect(await repository.listConversations('bob@def')).toEqual([]);
            expect((await repository.listConversations('carol@atlas')).length).toBe(1);
            expect((await repository.listConversations('root@def')).length).toBe(2);
            expect(conversationControls.deleteAll).not.toHaveBeenCalled();
        });

        it('shows an inline message when deleting another account fails', async () => {
            const { repository, notifyStorageChanged } = setup();
            await seedOthers(repository);
            jest.spyOn(repository, 'deleteAll').mockRejectedValueOnce(new Error('disk full'));
            renderSection();
            fireEvent.click(await screen.findByRole('button', { name: 'Delete chats of bob@def' }));
            fireEvent.click(screen.getByRole('button', { name: 'Confirm delete of bob@def' }));
            expect(await screen.findByText('Could not delete the chats of bob@def.')).toBeInTheDocument();
            expect(screen.getByText('bob@def')).toBeInTheDocument();
            expect(notifyStorageChanged).not.toHaveBeenCalled();
        });

        it('deletes every account through the repository and keeps the store persisting', async () => {
            const { repository, notifyStorageChanged } = setup();
            await seedOthers(repository);
            (deleteAssistantDatabase as jest.Mock).mockClear();
            (createConversationRepository as jest.Mock).mockClear();
            renderSection();
            fireEvent.click(await screen.findByRole('button', { name: 'Delete Rucio bot data for all accounts' }));
            fireEvent.click(screen.getByRole('button', { name: 'Delete everything' }));
            await waitFor(() => expect(notifyStorageChanged).toHaveBeenCalled());
            await waitFor(() => expect(screen.queryByText('Other accounts in this browser')).not.toBeInTheDocument());
            expect(screen.queryByRole('button', { name: 'Delete Conversation c1' })).not.toBeInTheDocument();
            expect(deleteAssistantDatabase).not.toHaveBeenCalled();
            expect(createConversationRepository).toHaveBeenCalledTimes(1);
            await repository.saveConversation(makeConversation('n1', 'root@def', '2026-10-25T08:00:00.000Z'));
            expect((await repository.listConversations('root@def')).map(c => c.id)).toEqual(['n1']);
        });

        it('stops a running turn through the controller before deleting all accounts', async () => {
            const conversationControls = { deleteConversation: jest.fn(), deleteAll: jest.fn().mockResolvedValue(undefined) };
            const { repository } = setup({ conversationControls });
            await seedOthers(repository);
            const deleteAllSpy = jest.spyOn(repository, 'deleteAll');
            renderSection();
            fireEvent.click(await screen.findByRole('button', { name: 'Delete Rucio bot data for all accounts' }));
            fireEvent.click(screen.getByRole('button', { name: 'Delete everything' }));
            await waitFor(() => expect(deleteAllSpy).toHaveBeenCalledWith());
            expect(conversationControls.deleteAll).toHaveBeenCalledTimes(1);
            expect(deleteAllSpy.mock.invocationCallOrder[0]).toBeGreaterThan(conversationControls.deleteAll.mock.invocationCallOrder[0]);
        });

        it('shows an inline message when deleting all accounts fails', async () => {
            const { repository, notifyStorageChanged } = setup();
            await seedOthers(repository);
            jest.spyOn(repository, 'deleteAll').mockRejectedValueOnce(new Error('blocked'));
            renderSection();
            fireEvent.click(await screen.findByRole('button', { name: 'Delete Rucio bot data for all accounts' }));
            fireEvent.click(screen.getByRole('button', { name: 'Delete everything' }));
            expect(await screen.findByText('Could not delete Rucio bot data.')).toBeInTheDocument();
            expect(notifyStorageChanged).not.toHaveBeenCalled();
        });

        it('shows an error instead of rejecting when listing accounts fails', async () => {
            const { repository } = setup();
            jest.spyOn(repository, 'listAccounts').mockRejectedValue(new Error('db closed'));
            renderSection();
            expect(await screen.findByText('Could not load saved chats.')).toBeInTheDocument();
        });

        it('shows no other accounts without a session', async () => {
            const { repository } = setup();
            await seedOthers(repository);
            mockSession.current = null;
            renderSection();
            await waitFor(() => expect(createConversationRepository).toHaveBeenCalled());
            await new Promise(resolve => setTimeout(resolve, 20));
            expect(screen.queryByText('Other accounts in this browser')).not.toBeInTheDocument();
        });
    });
});
