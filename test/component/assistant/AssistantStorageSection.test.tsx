jest.mock('next-auth/react', () => ({
    useSession: () => ({ data: { user: { rucioAccount: 'root', rucioVO: 'def' } } }),
}));
jest.mock('@/lib/infrastructure/assistant/indexeddb-conversation-repository', () => ({
    createConversationRepository: jest.fn(),
}));
jest.mock('@/lib/infrastructure/hooks/useAssistantShell', () => ({ useAssistantPanel: jest.fn() }));

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssistantStorageSection } from '@/component-library/features/assistant/settings/AssistantStorageSection';
import { InMemoryConversationRepository } from '@/lib/infrastructure/assistant/in-memory-conversation-repository';
import { createConversationRepository } from '@/lib/infrastructure/assistant/indexeddb-conversation-repository';
import { getDefaultAssistantSettings } from '@/lib/infrastructure/assistant/settings-storage';
import { useAssistantPanel } from '@/lib/infrastructure/hooks/useAssistantShell';
import { makeConversation } from 'test/fixtures/assistant-fixtures';

function setup(shellOverrides: Record<string, unknown> = {}) {
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
});
