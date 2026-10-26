import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { AssistantSettingsView, type AssistantSettingsViewProps } from '@/component-library/features/assistant/settings/AssistantSettingsView';
import { DEFAULT_ASSISTANT_CONFIG } from '@/lib/core/entity/assistant/assistant-config';
import { getDefaultAssistantSettings } from '@/lib/infrastructure/assistant/settings-storage';

const props = (overrides: Partial<AssistantSettingsViewProps> = {}): AssistantSettingsViewProps => ({
    config: {
        ...DEFAULT_ASSISTANT_CONFIG,
        defaultProvider: { kind: 'anthropic', model: 'claude-sonnet-5-5', label: 'Claude via CERN' },
    },
    configLoading: false,
    settings: {
        ...getDefaultAssistantSettings(),
        providers: [{ id: 'p-1', kind: 'ollama', label: 'Local', model: 'qwen3' }],
    },
    onUpdate: jest.fn(),
    onReset: jest.fn(),
    onTestConnection: jest.fn(async () => ({ ok: true as const, latencyMs: 1 })),
    newId: () => 'new-1',
    ...overrides,
});

describe('AssistantSettingsView', () => {
    it('opens on the providers tab', () => {
        render(<AssistantSettingsView {...props()} />);
        expect(screen.getByRole('heading', { level: 1, name: 'Rucio bot settings' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Providers' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText('Your providers')).toBeInTheDocument();
    });

    it('saves the display detail level', () => {
        const p = props();
        render(<AssistantSettingsView {...p} />);
        fireEvent.click(screen.getByRole('tab', { name: 'Display' }));
        fireEvent.click(screen.getByRole('radio', { name: /^Verbose/ }));
        const patch = (p.onUpdate as jest.Mock).mock.calls[0][0];
        expect(patch(getDefaultAssistantSettings()).display).toEqual({ detail: 'verbose' });
    });

    it('lists the shipped skills on the skills tab', async () => {
        render(<AssistantSettingsView {...props()} />);
        fireEvent.click(screen.getByRole('tab', { name: 'Skills' }));
        expect(screen.getByText('creating-replication-rules')).toBeInTheDocument();
        expect(await screen.findByText('Docs index details are not available.')).toBeInTheDocument();
    });

    it('clears the settings after confirmation', async () => {
        const p = props();
        render(<AssistantSettingsView {...p} />);
        fireEvent.click(screen.getByRole('tab', { name: 'Storage' }));
        fireEvent.click(screen.getByRole('button', { name: 'Clear assistant settings' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Clear settings' }));
        expect(p.onReset).toHaveBeenCalledTimes(1);
        expect(await screen.findByText('Assistant settings cleared.')).toBeInTheDocument();
    });

    it('does not clear when the confirmation is cancelled', async () => {
        const p = props();
        render(<AssistantSettingsView {...p} />);
        fireEvent.click(screen.getByRole('tab', { name: 'Storage' }));
        fireEvent.click(screen.getByRole('button', { name: 'Clear assistant settings' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        expect(p.onReset).not.toHaveBeenCalled();
    });

    it('warns when the operator settings could not be loaded', () => {
        render(<AssistantSettingsView {...props({ configError: new Error('boom') })} />);
        expect(screen.getByText('Could not load the operator settings. Showing defaults.')).toBeInTheDocument();
    });

    it('waits for the operator settings before showing providers', () => {
        render(<AssistantSettingsView {...props({ configLoading: true })} />);
        expect(screen.queryByText('Your providers')).not.toBeInTheDocument();
        expect(screen.getByText('Loading operator settings')).toBeInTheDocument();
    });

    it('shows the telemetry tab', () => {
        render(<AssistantSettingsView {...props()} />);
        fireEvent.click(screen.getByRole('tab', { name: 'Telemetry' }));
        expect(screen.getByRole('checkbox', { name: 'Export traces to my own collector' })).toBeInTheDocument();
    });

    it('uses no em dashes in any tab', async () => {
        render(<AssistantSettingsView {...props()} />);
        let text = document.body.textContent ?? '';
        ['Providers', 'Skills', 'Telemetry', 'Display', 'Storage'].forEach(name => {
            fireEvent.click(screen.getByRole('tab', { name }));
            text += document.body.textContent ?? '';
        });
        expect(text).not.toContain(String.fromCharCode(0x2014));
        // Let the storage section finish opening its repository.
        await act(async () => undefined);
    });
});
