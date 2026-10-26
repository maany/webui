import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import {
    TelemetrySettingsForm,
    operatorShareDescription,
    telemetryTestMessage,
    type TelemetrySettingsFormProps,
} from '@/component-library/features/assistant/settings/TelemetrySettingsForm';
import type { AssistantConfig } from '@/lib/core/entity/assistant/assistant-config';
import type { AssistantSettings } from '@/lib/core/entity/assistant/settings';
import type { TelemetryTestResult } from '@/lib/infrastructure/assistant/telemetry-sinks';

const ORIGIN = 'https://rucio-ui.example.org';

const config = (patch: Partial<AssistantConfig['telemetry']> = {}): AssistantConfig['telemetry'] => ({
    operatorSink: false,
    allowUserSinks: true,
    contentCap: 'full',
    hashUser: false,
    ...patch,
});

const enabledLangfuse: AssistantSettings['telemetry'] = {
    enabled: true,
    contentLevel: 'metadata',
    sink: { kind: 'langfuse', endpoint: 'https://cloud.langfuse.com', publicKey: 'pk-lf-1', secretKey: 'sk-lf-1' },
    shareWithOperator: false,
};

const METADATA_SHARE_TEXT = 'The operators of this deployment receive timings, token counts and tool names only, never prompts or results.';

/** Keeps the value in state like the real settings hook does. */
function Harness(
    props: Omit<TelemetrySettingsFormProps, 'value' | 'onChange' | 'origin'> & { initial: AssistantSettings['telemetry']; onChangeSpy?: jest.Mock },
) {
    const [value, setValue] = useState(props.initial);
    return (
        <TelemetrySettingsForm
            config={props.config}
            value={value}
            origin={ORIGIN}
            onTestExport={props.onTestExport}
            onChange={next => {
                props.onChangeSpy?.(next);
                setValue(next);
            }}
        />
    );
}

const okExport = jest.fn(async (): Promise<TelemetryTestResult> => ({ ok: true, status: 200 }));

describe('TelemetrySettingsForm', () => {
    it('shows the sink fields after opting in, with the plaintext warning', async () => {
        const user = userEvent.setup();
        const onChangeSpy = jest.fn();
        render(
            <Harness
                config={config()}
                initial={{ enabled: false, contentLevel: 'metadata', shareWithOperator: false }}
                onTestExport={okExport}
                onChangeSpy={onChangeSpy}
            />,
        );
        expect(screen.queryByLabelText('Langfuse base URL')).not.toBeInTheDocument();

        await user.click(screen.getByRole('checkbox', { name: 'Export traces to my own collector' }));
        expect(onChangeSpy).toHaveBeenLastCalledWith({ enabled: true, contentLevel: 'metadata', shareWithOperator: false });
        expect(screen.getByLabelText('Langfuse base URL')).toBeInTheDocument();
        expect(screen.getByLabelText('Public key')).toBeInTheDocument();
        expect(screen.getByLabelText('Secret key')).toHaveAttribute('type', 'password');
        expect(screen.getByText('Keys are stored in this browser in plain text. Use keys that can only write traces.')).toBeInTheDocument();
    });

    it('edits the sink and switches to OTLP with headers', async () => {
        const user = userEvent.setup();
        const onChangeSpy = jest.fn();
        render(
            <Harness
                config={config()}
                initial={{ enabled: true, contentLevel: 'metadata', shareWithOperator: false }}
                onTestExport={okExport}
                onChangeSpy={onChangeSpy}
            />,
        );
        await user.click(screen.getByRole('radio', { name: 'OTLP endpoint' }));
        await user.type(screen.getByLabelText('OTLP traces URL'), 'https://otel.example.org/v1/traces');
        await user.type(screen.getByLabelText('Headers'), 'x-team=ddm');
        expect(onChangeSpy).toHaveBeenLastCalledWith({
            enabled: true,
            contentLevel: 'metadata',
            shareWithOperator: false,
            sink: { kind: 'otlp', endpoint: 'https://otel.example.org/v1/traces', headers: { 'x-team': 'ddm' } },
        });
    });

    it('hides the user sink when the operator disallows it and offers sharing, off by default', () => {
        render(
            <Harness
                config={config({ allowUserSinks: false, operatorSink: true, contentCap: 'metadata' })}
                initial={enabledLangfuse}
                onTestExport={okExport}
            />,
        );
        expect(screen.queryByRole('checkbox', { name: 'Export traces to my own collector' })).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Langfuse base URL')).not.toBeInTheDocument();
        expect(screen.getByText('Your operator does not allow personal trace sinks.')).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Share traces with this deployment' })).not.toBeChecked();
        expect(screen.getByText(METADATA_SHARE_TEXT)).toBeInTheDocument();
        expect(screen.queryByText(/Your operator collects/)).not.toBeInTheDocument();
    });

    it('shares traces with the deployment only after opting in, and opts out again', async () => {
        const user = userEvent.setup();
        const onChangeSpy = jest.fn();
        render(<Harness config={config({ operatorSink: true })} initial={enabledLangfuse} onTestExport={okExport} onChangeSpy={onChangeSpy} />);
        const share = screen.getByRole('checkbox', { name: 'Share traces with this deployment' });
        expect(share).not.toBeChecked();
        expect(onChangeSpy).not.toHaveBeenCalled();
        await user.click(share);
        expect(onChangeSpy).toHaveBeenLastCalledWith({ ...enabledLangfuse, shareWithOperator: true });
        await user.click(share);
        expect(onChangeSpy).toHaveBeenLastCalledWith({ ...enabledLangfuse, shareWithOperator: false });
    });

    it('does not offer sharing when the operator has no sink', () => {
        render(<Harness config={config()} initial={enabledLangfuse} onTestExport={okExport} />);
        expect(screen.queryByRole('checkbox', { name: 'Share traces with this deployment' })).not.toBeInTheDocument();
    });

    it('disables content levels above the operator cap', () => {
        render(
            <Harness config={config({ contentCap: 'metadata' })} initial={{ ...enabledLangfuse, contentLevel: 'full' }} onTestExport={okExport} />,
        );
        expect(screen.getByRole('radio', { name: /Full content \(operator limit\)/ })).toBeDisabled();
        expect(screen.getByRole('radio', { name: /Metadata only/ })).toBeChecked();
    });

    it('lets the user pick full content when the cap allows it', async () => {
        const user = userEvent.setup();
        const onChangeSpy = jest.fn();
        render(<Harness config={config()} initial={enabledLangfuse} onTestExport={okExport} onChangeSpy={onChangeSpy} />);
        await user.click(screen.getByRole('radio', { name: /Full content/ }));
        expect(onChangeSpy).toHaveBeenLastCalledWith({ ...enabledLangfuse, contentLevel: 'full' });
    });

    it('disables Test export until the sink is complete', () => {
        render(
            <Harness
                config={config()}
                initial={{
                    enabled: true,
                    contentLevel: 'metadata',
                    shareWithOperator: false,
                    sink: { kind: 'langfuse', endpoint: 'https://cloud.langfuse.com' },
                }}
                onTestExport={okExport}
            />,
        );
        expect(screen.getByRole('button', { name: 'Test export' })).toBeDisabled();
    });

    it('sends a test span and shows the hint for the result', async () => {
        const user = userEvent.setup();
        const onTestExport = jest.fn(async (): Promise<TelemetryTestResult> => ({ ok: false, reason: 'network' }));
        render(<Harness config={config()} initial={enabledLangfuse} onTestExport={onTestExport} />);
        await user.click(screen.getByRole('button', { name: 'Test export' }));
        expect(onTestExport).toHaveBeenCalledWith(enabledLangfuse.sink);
        await waitFor(() =>
            expect(
                screen.getByText(
                    `The request was blocked or the endpoint is unreachable. Check the URL and that the collector allows CORS from ${ORIGIN}.`,
                ),
            ).toBeInTheDocument(),
        );
    });

    it('has no accessibility violations', async () => {
        const { container } = render(<Harness config={config({ operatorSink: true })} initial={enabledLangfuse} onTestExport={okExport} />);
        expect(await axe(container)).toHaveNoViolations();
    });

    it('uses no em dashes in its copy', async () => {
        const { container } = render(
            <Harness config={config({ operatorSink: true, contentCap: 'metadata' })} initial={enabledLangfuse} onTestExport={okExport} />,
        );
        expect(container.textContent).not.toContain('\u2014');
        const results: TelemetryTestResult[] = [
            { ok: true, status: 200 },
            ...(['invalid-url', 'mixed-content', 'network', 'unauthorized', 'not-found', 'timeout'] as const).map(reason => ({
                ok: false as const,
                reason,
            })),
            { ok: false, reason: 'http-error', status: 502 },
        ];
        results.forEach(result => expect(telemetryTestMessage(result, ORIGIN)).not.toContain('\u2014'));
        [config({ operatorSink: true }), config({ operatorSink: true, contentCap: 'metadata', hashUser: true })].forEach(c =>
            expect(operatorShareDescription(c)).not.toContain('\u2014'),
        );
    });
});

describe('operatorShareDescription', () => {
    it('states what the operator cap lets through and whether the account is hashed', () => {
        expect(operatorShareDescription(config({ operatorSink: true, contentCap: 'metadata' }))).toBe(METADATA_SHARE_TEXT);
        expect(operatorShareDescription(config({ operatorSink: true, contentCap: 'full', hashUser: true }))).toBe(
            'The operators of this deployment receive timings, token counts and tool names, plus prompts and results if you choose full content. Your account is replaced by a salted hash.',
        );
    });
});

describe('telemetryTestMessage', () => {
    it.each<[TelemetryTestResult, string]>([
        [{ ok: true, status: 200 }, 'Test span sent. Look for a trace named "Rucio bot test".'],
        [{ ok: false, reason: 'unauthorized', status: 401 }, 'The endpoint rejected the credentials. Check the keys or headers.'],
        [{ ok: false, reason: 'mixed-content' }, 'This page uses https, so the browser blocks an http endpoint. Use an https endpoint.'],
        [{ ok: false, reason: 'http-error', status: 502 }, 'The endpoint answered with HTTP 502.'],
    ])('maps %j', (result, message) => {
        expect(telemetryTestMessage(result, ORIGIN)).toBe(message);
    });
});
