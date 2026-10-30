import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ProvidersTab } from '@/component-library/features/assistant/settings/ProvidersTab';
import { DEFAULT_ASSISTANT_CONFIG, type AssistantConfig } from '@/lib/core/entity/assistant/assistant-config';
import type { AssistantSettings } from '@/lib/core/entity/assistant/settings';
import type { ProviderConfig } from '@/lib/core/entity/assistant/provider-config';
import { getDefaultAssistantSettings } from '@/lib/infrastructure/assistant/settings-storage';
import type { ConnectionTestResult } from '@/lib/infrastructure/assistant/connection-test';

const operatorConfig: AssistantConfig = {
    ...DEFAULT_ASSISTANT_CONFIG,
    defaultProvider: { kind: 'openai-compatible', model: 'gpt-oss-120b', label: 'CERN GPT-OSS', contextWindow: 131072 },
};
const claude: ProviderConfig = { id: 'p-claude', kind: 'anthropic', label: 'My Claude', apiKey: 'sk-ant-test', model: 'claude-sonnet-5-5' };

function renderTab(options: { config?: AssistantConfig; settings?: Partial<AssistantSettings>; onTest?: jest.Mock } = {}) {
    const latest: { current: AssistantSettings } = { current: { ...getDefaultAssistantSettings(), ...options.settings } };
    const onTest = options.onTest ?? jest.fn(async (): Promise<ConnectionTestResult> => ({ ok: true, latencyMs: 42 }));
    let counter = 0;
    const Harness = () => {
        const [settings, setSettings] = React.useState(latest.current);
        return (
            <ProvidersTab
                config={options.config ?? operatorConfig}
                settings={settings}
                onUpdate={patch => {
                    latest.current = patch(latest.current);
                    setSettings(latest.current);
                }}
                onTestConnection={onTest}
                newId={() => `new-${++counter}`}
            />
        );
    };
    const view = render(<Harness />);
    return { latest, onTest, unmount: view.unmount };
}

const card = (label: string) => screen.getByRole('listitem', { name: label });

describe('ProvidersTab', () => {
    it('shows the operator default read-only and active', () => {
        renderTab();
        const operator = card('CERN GPT-OSS');
        expect(within(operator).getByText('Operator default')).toBeInTheDocument();
        expect(within(operator).getByText('Active')).toBeInTheDocument();
        expect(within(operator).getByText(/The key stays on the server/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Edit CERN GPT-OSS' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Delete CERN GPT-OSS' })).not.toBeInTheDocument();
    });

    it('adds a provider from the form', async () => {
        const { latest } = renderTab();
        fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('radio', { name: /^Anthropic/ }));
        fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'My Claude' } });
        fireEvent.change(within(dialog).getByLabelText(/^API key/), { target: { value: 'sk-ant-test' } });
        fireEvent.change(within(dialog).getByLabelText(/^Model/), { target: { value: 'claude-sonnet-5-5' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save provider' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(latest.current.providers).toEqual([
            { id: 'new-1', kind: 'anthropic', label: 'My Claude', apiKey: 'sk-ant-test', model: 'claude-sonnet-5-5' },
        ]);
        expect(latest.current.activeProviderId).toBe('operator');
        expect(within(card('My Claude')).getByText('$2 in, $10 out per million tokens')).toBeInTheDocument();
    });

    it('makes the first provider active when there is no operator default', async () => {
        const { latest } = renderTab({ config: DEFAULT_ASSISTANT_CONFIG });
        fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('radio', { name: /^Ollama/ }));
        fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Local' } });
        fireEvent.change(within(dialog).getByLabelText(/^Model/), { target: { value: 'qwen3' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save provider' }));
        await waitFor(() => expect(latest.current.activeProviderId).toBe('new-1'));
        expect(within(card('Local')).getByText('No price')).toBeInTheDocument();
    });

    it('hides personal providers when the operator turned them off', () => {
        renderTab({ config: { ...operatorConfig, allowByok: false }, settings: { providers: [claude] } });
        expect(screen.queryByRole('button', { name: 'Add provider' })).not.toBeInTheDocument();
        expect(screen.queryByText('My Claude')).not.toBeInTheDocument();
        expect(screen.getByText(/turned off personal providers/)).toBeInTheDocument();
    });

    it('tells the user when no model is available at all', () => {
        renderTab({ config: { ...DEFAULT_ASSISTANT_CONFIG, allowByok: false } });
        expect(screen.getByText('No model is set up yet. Ask your Rucio operator to configure one.')).toBeInTheDocument();
    });

    it('chooses the active provider', () => {
        const { latest } = renderTab({ settings: { providers: [claude] } });
        fireEvent.click(screen.getByRole('button', { name: 'Use My Claude' }));
        expect(latest.current.activeProviderId).toBe('p-claude');
        expect(within(card('My Claude')).getByText('Active')).toBeInTheDocument();
        expect(within(card('CERN GPT-OSS')).queryByText('Active')).not.toBeInTheDocument();
    });

    it('edits a provider in place', async () => {
        const { latest } = renderTab({ settings: { providers: [claude] } });
        fireEvent.click(screen.getByRole('button', { name: 'Edit My Claude' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByLabelText(/^Name/)).toHaveValue('My Claude');
        fireEvent.change(within(dialog).getByLabelText(/^Model/), { target: { value: 'claude-opus-5-5' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save provider' }));
        await waitFor(() => expect(latest.current.providers).toEqual([{ ...claude, model: 'claude-opus-5-5' }]));
    });

    it('deletes the active provider after confirmation and falls back to the operator default', async () => {
        const { latest } = renderTab({ settings: { providers: [claude], activeProviderId: 'p-claude' } });
        fireEvent.click(screen.getByRole('button', { name: 'Delete My Claude' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete provider' }));
        await waitFor(() => expect(latest.current.providers).toEqual([]));
        expect(latest.current.activeProviderId).toBe('operator');
    });

    it('stores keys for this tab only when asked', () => {
        const { latest } = renderTab();
        fireEvent.click(screen.getByRole('radio', { name: /^This tab only/ }));
        expect(latest.current.keyStorage).toBe('session');
    });

    it('tests a personal provider directly', async () => {
        const { onTest } = renderTab({ settings: { providers: [claude] } });
        fireEvent.click(screen.getByRole('button', { name: 'Test connection for My Claude' }));
        expect(await screen.findByText('Connected in 42 ms.')).toBeInTheDocument();
        expect(onTest).toHaveBeenCalledWith(
            expect.objectContaining({ providerId: 'p-claude', kind: 'anthropic', model: 'claude-sonnet-5-5', apiKey: 'sk-ant-test', via: 'direct' }),
            expect.any(AbortSignal),
        );
    });

    it('tests the operator default through the relay', async () => {
        const { onTest } = renderTab();
        fireEvent.click(screen.getByRole('button', { name: 'Test connection for CERN GPT-OSS' }));
        await screen.findByText('Connected in 42 ms.');
        expect(onTest).toHaveBeenCalledWith(
            expect.objectContaining({ providerId: 'operator', via: 'relay', baseURL: '/api/assistant/llm' }),
            expect.any(AbortSignal),
        );
        expect(onTest.mock.calls[0][0]).not.toHaveProperty('apiKey');
    });

    it('shows the hint of a failed test', async () => {
        const hint = 'Ollama did not accept requests from this page. Start it with: OLLAMA_ORIGINS=http://localhost ollama serve';
        renderTab({ onTest: jest.fn(async () => ({ ok: false, code: 'cors', hint })) });
        fireEvent.click(screen.getByRole('button', { name: 'Test connection for CERN GPT-OSS' }));
        expect(await screen.findByText(hint)).toBeInTheDocument();
    });

    it('marks providers of a kind the operator does not allow', () => {
        renderTab({ config: { ...operatorConfig, allowedProviderKinds: ['ollama'] }, settings: { providers: [claude] } });
        expect(within(card('My Claude')).getByText('Not allowed by the operator')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Use My Claude' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Test connection for My Claude' })).toBeDisabled();
    });

    it('warns when the active provider cannot be used', () => {
        renderTab({
            config: { ...operatorConfig, allowedProviderKinds: ['ollama'] },
            settings: { providers: [claude], activeProviderId: 'p-claude' },
        });
        expect(
            screen.getByText('Rucio bot cannot use your active provider. Your operator does not allow this provider type. Choose another one below.'),
        ).toBeInTheDocument();
    });

    it('ends in a failure alert when the test rejects', async () => {
        renderTab({ onTest: jest.fn(async () => Promise.reject(new Error('boom'))) });
        fireEvent.click(screen.getByRole('button', { name: 'Test connection for CERN GPT-OSS' }));
        expect(await screen.findByText('The connection test failed unexpectedly. Try again.')).toBeInTheDocument();
    });

    it('aborts a running test on unmount', async () => {
        const signals: AbortSignal[] = [];
        const onTest = jest.fn((_resolved: unknown, signal?: AbortSignal) => {
            signals.push(signal as AbortSignal);
            return new Promise<ConnectionTestResult>(() => {});
        });
        const { unmount } = renderTab({ onTest });
        fireEvent.click(screen.getByRole('button', { name: 'Test connection for CERN GPT-OSS' }));
        await waitFor(() => expect(signals).toHaveLength(1));
        expect(signals[0].aborted).toBe(false);
        unmount();
        expect(signals[0].aborted).toBe(true);
    });

    it('ignores a result that arrives after the provider was edited', async () => {
        let resolveTest: (result: ConnectionTestResult) => void = () => {};
        const onTest = jest.fn(() => new Promise<ConnectionTestResult>(resolve => (resolveTest = resolve)));
        renderTab({ settings: { providers: [claude] }, onTest });
        fireEvent.click(screen.getByRole('button', { name: 'Test connection for My Claude' }));
        fireEvent.click(screen.getByRole('button', { name: 'Edit My Claude' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save provider' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        resolveTest({ ok: true, latencyMs: 1 });
        await Promise.resolve();
        expect(screen.queryByText(/Connected in/)).not.toBeInTheDocument();
    });

    it('clears a shown result when the provider is edited', async () => {
        renderTab({ settings: { providers: [claude] } });
        fireEvent.click(screen.getByRole('button', { name: 'Test connection for My Claude' }));
        await screen.findByText('Connected in 42 ms.');
        fireEvent.click(screen.getByRole('button', { name: 'Edit My Claude' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save provider' }));
        await waitFor(() => expect(screen.queryByText('Connected in 42 ms.')).not.toBeInTheDocument());
    });

    it('selects the next allowed provider when the active one is deleted and there is no operator default', async () => {
        const other: ProviderConfig = { id: 'p-other', kind: 'anthropic', label: 'Other', apiKey: 'k', model: 'claude-sonnet-5-5' };
        const { latest } = renderTab({ config: DEFAULT_ASSISTANT_CONFIG, settings: { providers: [claude, other], activeProviderId: 'p-claude' } });
        fireEvent.click(screen.getByRole('button', { name: 'Delete My Claude' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete provider' }));
        await waitFor(() => expect(latest.current.activeProviderId).toBe('p-other'));
    });
});
