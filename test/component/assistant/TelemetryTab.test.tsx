import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_ASSISTANT_CONFIG } from '@/lib/core/entity/assistant/assistant-config';
import type { AssistantSettings } from '@/lib/core/entity/assistant/settings';
import { TelemetryTab } from '@/component-library/features/assistant/settings/TelemetryTab';

const testTelemetryExport = jest.fn(async () => ({ ok: false as const, reason: 'unauthorized' as const, status: 401 }));
jest.mock('@/lib/infrastructure/assistant/telemetry-test-export', () => ({
    __esModule: true,
    testTelemetryExport: (...args: unknown[]) => testTelemetryExport(...(args as [])),
}));

const settings = {
    telemetry: {
        enabled: true,
        contentLevel: 'metadata',
        sink: { kind: 'langfuse', endpoint: 'https://cloud.langfuse.com', publicKey: 'pk-lf-1', secretKey: 'sk-lf-1' },
        shareWithOperator: false,
    },
} as unknown as AssistantSettings;

describe('TelemetryTab', () => {
    it('saves changes through onUpdate and tests the Langfuse endpoint', async () => {
        const onUpdate = jest.fn();
        const user = userEvent.setup();
        render(<TelemetryTab config={DEFAULT_ASSISTANT_CONFIG} settings={settings} onUpdate={onUpdate} />);
        await user.click(screen.getByRole('checkbox', { name: 'Export traces to my own collector' }));
        const patch = onUpdate.mock.calls[0][0] as (s: AssistantSettings) => AssistantSettings;
        expect(patch(settings).telemetry.enabled).toBe(false);

        await user.click(screen.getByRole('button', { name: 'Test export' }));
        await waitFor(() => expect(testTelemetryExport).toHaveBeenCalledTimes(1));
        expect(testTelemetryExport).toHaveBeenCalledWith({
            url: 'https://cloud.langfuse.com/api/public/otel/v1/traces',
            headers: { Authorization: `Basic ${btoa('pk-lf-1:sk-lf-1')}`, 'x-langfuse-ingestion-version': '4' },
        });
        expect(await screen.findByText('The endpoint rejected the credentials. Check the keys or headers.')).toBeInTheDocument();
    });
});
