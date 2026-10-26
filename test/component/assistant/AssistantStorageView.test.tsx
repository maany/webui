jest.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }));

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { AssistantStorageView, type AssistantStorageViewProps } from '@/component-library/features/assistant/settings/AssistantStorageSection';
import { makeConversation } from 'test/fixtures/assistant-fixtures';

function props(overrides: Partial<AssistantStorageViewProps> = {}): AssistantStorageViewProps {
    return {
        conversations: [
            makeConversation('c1', 'root@def', '2026-10-24T08:00:00.000Z'),
            makeConversation('c2', 'root@def', '2026-10-23T08:00:00.000Z'),
        ],
        sizes: { c1: 2048, c2: 512 },
        totalBytes: 2560,
        browserUsage: { usage: 3 * 1024 * 1024, quota: 100 * 1024 * 1024 },
        memoryBytes: 1024,
        persistent: true,
        retention: { maxAgeDays: 30, maxTotalMB: 50, clearOnLogout: false },
        onRetentionChange: jest.fn(),
        onExport: jest.fn(),
        onDelete: jest.fn(),
        onDeleteAll: jest.fn(),
        onFreeMemory: jest.fn(),
        ...overrides,
    };
}

describe('AssistantStorageView', () => {
    it('lists chats with sizes and totals', () => {
        render(<AssistantStorageView {...props()} />);
        expect(screen.getByText(/2 chats for this account, 2.5 kB/)).toBeInTheDocument();
        expect(screen.getByText(/uses 3.0 MB of 100.0 MB/)).toBeInTheDocument();
        expect(screen.getByText('2026-10-24 · 2.0 kB')).toBeInTheDocument();
    });

    it('exports and deletes one chat', () => {
        const p = props();
        render(<AssistantStorageView {...p} />);
        fireEvent.click(screen.getByRole('button', { name: 'Export Conversation c1 as Markdown' }));
        fireEvent.click(screen.getByRole('button', { name: 'Export Conversation c2 as JSON' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete Conversation c1' }));
        expect(p.onExport).toHaveBeenCalledWith('c1', 'md');
        expect(p.onExport).toHaveBeenCalledWith('c2', 'json');
        expect(p.onDelete).toHaveBeenCalledWith('c1');
    });

    it('asks before deleting all chats', () => {
        const p = props();
        render(<AssistantStorageView {...p} />);
        fireEvent.click(screen.getByRole('button', { name: 'Delete all chats' }));
        expect(p.onDeleteAll).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Delete all' }));
        expect(p.onDeleteAll).toHaveBeenCalled();
    });

    it('backs out of deleting all chats', () => {
        const p = props();
        render(<AssistantStorageView {...p} />);
        fireEvent.click(screen.getByRole('button', { name: 'Delete all chats' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(p.onDeleteAll).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Delete all chats' })).toBeInTheDocument();
    });

    it('edits retention and clear on logout', () => {
        const p = props();
        render(<AssistantStorageView {...p} />);
        fireEvent.change(screen.getByLabelText('Delete chats older than (days)'), { target: { value: '7' } });
        expect(p.onRetentionChange).toHaveBeenCalledWith({ maxAgeDays: 7, maxTotalMB: 50, clearOnLogout: false });
        fireEvent.click(screen.getByLabelText('Delete all Rucio bot chats when I sign out'));
        expect(p.onRetentionChange).toHaveBeenCalledWith({ maxAgeDays: 30, maxTotalMB: 50, clearOnLogout: true });
    });

    it('frees memory, or says nothing is loaded', () => {
        const p = props();
        const { rerender } = render(<AssistantStorageView {...p} />);
        fireEvent.click(screen.getByRole('button', { name: 'Free memory now' }));
        expect(p.onFreeMemory).toHaveBeenCalled();
        rerender(<AssistantStorageView {...props({ memoryBytes: null })} />);
        expect(screen.getByText('No data tables are loaded.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Free memory now' })).toBeDisabled();
    });

    it('warns when chats cannot be saved', () => {
        render(<AssistantStorageView {...props({ persistent: false })} />);
        expect(screen.getByText('This browser does not allow saving chats. History is kept in memory only.')).toBeInTheDocument();
    });

    it('shows an inline error', () => {
        render(<AssistantStorageView {...props({ error: 'Could not delete this chat.' })} />);
        expect(screen.getByRole('alert')).toHaveTextContent('Could not delete this chat.');
    });
});
