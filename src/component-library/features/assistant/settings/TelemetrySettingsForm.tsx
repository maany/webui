'use client';

import { useId, useState } from 'react';
import type { AssistantConfig, TelemetryContentLevel } from '@/lib/core/entity/assistant/assistant-config';
import type { AssistantSettings, TelemetrySinkSettings } from '@/lib/core/entity/assistant/settings';
import { effectiveContentLevel, isContentLevelAllowed, isUserSinkComplete } from '@/lib/core/services/assistant-telemetry';
import { formatOtlpHeaders, parseOtlpHeaders } from '@/lib/infrastructure/assistant/otlp-headers';
import type { TelemetryTestResult } from '@/lib/infrastructure/assistant/telemetry-sinks';
import { Alert } from '@/component-library/atoms/feedback/Alert';
import { Button } from '@/component-library/atoms/form/button';
import { Checkbox } from '@/component-library/atoms/form/checkbox';
import { Input } from '@/component-library/atoms/form/input';
import { ChoiceGroup, type ChoiceOption } from './ChoiceGroup';

export interface TelemetrySettingsFormProps {
    config: AssistantConfig['telemetry'];
    value: AssistantSettings['telemetry'];
    onChange(next: AssistantSettings['telemetry']): void;
    onTestExport(sink: TelemetrySinkSettings): Promise<TelemetryTestResult>;
    /** Page origin, shown in the CORS hint. */
    origin: string;
}

const CONTENT_LEVEL_LABELS: Record<TelemetryContentLevel, { label: string; description: string }> = {
    metadata: { label: 'Metadata only', description: 'Timings, token counts, tool names and status. No prompts, arguments, results or SQL.' },
    full: { label: 'Full content', description: 'Also prompts, answers, tool arguments, results and SQL. Secrets are removed before export.' },
};

const SINK_KIND_OPTIONS: ChoiceOption<TelemetrySinkSettings['kind']>[] = [
    { value: 'langfuse', label: 'Langfuse' },
    { value: 'otlp', label: 'OTLP endpoint' },
];

export function telemetryTestMessage(result: TelemetryTestResult, origin: string): string {
    if (result.ok) {
        return 'Test span sent. Look for a trace named "Rucio bot test".';
    }
    switch (result.reason) {
        case 'invalid-url':
            return 'The endpoint is not a valid http or https URL.';
        case 'mixed-content':
            return 'This page uses https, so the browser blocks an http endpoint. Use an https endpoint.';
        case 'network':
            return `The request was blocked or the endpoint is unreachable. Check the URL and that the collector allows CORS from ${origin}.`;
        case 'unauthorized':
            return 'The endpoint rejected the credentials. Check the keys or headers.';
        case 'not-found':
            return 'Nothing answers at this path. For Langfuse, enter the base URL, for example https://cloud.langfuse.com.';
        case 'timeout':
            return 'The endpoint did not answer within 10 seconds.';
        case 'http-error':
            return `The endpoint answered with HTTP ${result.status ?? 'error'}.`;
    }
}

/** One line under "Share traces with this deployment": what the operator's content cap lets through. */
export function operatorShareDescription(config: AssistantConfig['telemetry']): string {
    const content =
        config.contentCap === 'full'
            ? 'The operators of this deployment receive timings, token counts and tool names, plus prompts and results if you choose full content. Full content can still name you, for example in prompts, SQL or data identifiers.'
            : 'The operators of this deployment receive timings, token counts and tool names only, never prompts or results.';
    return config.hashUser ? `${content} Your account is replaced by a salted hash.` : content;
}

export function TelemetrySettingsForm({ config, value, onChange, onTestExport, origin }: TelemetrySettingsFormProps) {
    const id = useId();
    const sink: TelemetrySinkSettings = value.sink ?? { kind: 'langfuse', endpoint: '' };
    const [headersText, setHeadersText] = useState(formatOtlpHeaders(value.sink?.headers));
    const [testState, setTestState] = useState<{ status: 'idle' } | { status: 'testing' } | { status: 'done'; result: TelemetryTestResult }>({
        status: 'idle',
    });
    const effective = effectiveContentLevel(value.contentLevel, config.contentCap);
    const contentOptions: ChoiceOption<TelemetryContentLevel>[] = (Object.keys(CONTENT_LEVEL_LABELS) as TelemetryContentLevel[]).map(level => {
        const allowed = isContentLevelAllowed(level, config.contentCap);
        return {
            value: level,
            label: allowed ? CONTENT_LEVEL_LABELS[level].label : `${CONTENT_LEVEL_LABELS[level].label} (operator limit)`,
            description: CONTENT_LEVEL_LABELS[level].description,
            disabled: !allowed,
        };
    });

    const updateSink = (patch: Partial<TelemetrySinkSettings>) => {
        setTestState({ status: 'idle' });
        onChange({ ...value, sink: { ...sink, ...patch } });
    };

    const runTest = async () => {
        setTestState({ status: 'testing' });
        try {
            setTestState({ status: 'done', result: await onTestExport(sink) });
        } catch {
            setTestState({ status: 'done', result: { ok: false, reason: 'network' } });
        }
    };

    return (
        <div className="flex flex-col gap-6">
            {config.operatorSink && (
                <section aria-labelledby={`${id}-operator`} className="flex flex-col gap-2">
                    <h2 id={`${id}-operator`} className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                        This deployment
                    </h2>
                    <div className="flex items-center gap-3">
                        <Checkbox
                            id={`${id}-share`}
                            checked={value.shareWithOperator === true}
                            aria-describedby={`${id}-share-description`}
                            onCheckedChange={checked => onChange({ ...value, shareWithOperator: checked === true })}
                        />
                        <label htmlFor={`${id}-share`} className="text-sm text-neutral-900 dark:text-neutral-100">
                            Share traces with this deployment
                        </label>
                    </div>
                    <p id={`${id}-share-description`} className="text-sm text-neutral-600 dark:text-neutral-400">
                        {operatorShareDescription(config)}
                    </p>
                </section>
            )}

            {config.allowUserSinks ? (
                <section aria-labelledby={`${id}-sink`} className="flex flex-col gap-4">
                    <h2 id={`${id}-sink`} className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                        Your trace sink
                    </h2>
                    <div className="flex items-center gap-3">
                        <Checkbox
                            id={`${id}-enabled`}
                            checked={value.enabled}
                            onCheckedChange={checked => onChange({ ...value, enabled: checked === true })}
                        />
                        <label htmlFor={`${id}-enabled`} className="text-sm text-neutral-900 dark:text-neutral-100">
                            Export traces to my own collector
                        </label>
                    </div>

                    {value.enabled && (
                        <>
                            <ChoiceGroup
                                name={`${id}-kind`}
                                legend="Sink"
                                value={sink.kind}
                                options={SINK_KIND_OPTIONS}
                                onChange={kind => updateSink({ kind })}
                            />

                            <div className="flex flex-col gap-1">
                                <label htmlFor={`${id}-endpoint`} className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                                    {sink.kind === 'langfuse' ? 'Langfuse base URL' : 'OTLP traces URL'}
                                </label>
                                <Input
                                    id={`${id}-endpoint`}
                                    type="url"
                                    value={sink.endpoint}
                                    placeholder={sink.kind === 'langfuse' ? 'https://cloud.langfuse.com' : 'https://collector.example.org/v1/traces'}
                                    onChange={event => updateSink({ endpoint: event.target.value })}
                                />
                            </div>

                            {sink.kind === 'langfuse' ? (
                                <>
                                    <div className="flex flex-col gap-1">
                                        <label htmlFor={`${id}-public`} className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                                            Public key
                                        </label>
                                        <Input
                                            id={`${id}-public`}
                                            value={sink.publicKey ?? ''}
                                            autoComplete="off"
                                            spellCheck={false}
                                            autoCapitalize="off"
                                            onChange={event => updateSink({ publicKey: event.target.value })}
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label htmlFor={`${id}-secret`} className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                                            Secret key
                                        </label>
                                        <Input
                                            id={`${id}-secret`}
                                            type="password"
                                            value={sink.secretKey ?? ''}
                                            autoComplete="off"
                                            spellCheck={false}
                                            autoCapitalize="off"
                                            onChange={event => updateSink({ secretKey: event.target.value })}
                                        />
                                    </div>
                                </>
                            ) : (
                                <div className="flex flex-col gap-1">
                                    <label htmlFor={`${id}-headers`} className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                                        Headers
                                    </label>
                                    <Input
                                        id={`${id}-headers`}
                                        value={headersText}
                                        placeholder="Authorization=Bearer xyz,x-scope=team"
                                        autoComplete="off"
                                        spellCheck={false}
                                        autoCapitalize="off"
                                        onChange={event => {
                                            setHeadersText(event.target.value);
                                            updateSink({ headers: parseOtlpHeaders(event.target.value) });
                                        }}
                                    />
                                </div>
                            )}

                            <Alert variant="warning" message="Keys are stored in this browser in plain text. Use keys that can only write traces." />

                            <div className="flex flex-col gap-2">
                                <div>
                                    <Button
                                        type="button"
                                        variant="neutral"
                                        disabled={!isUserSinkComplete(sink) || testState.status === 'testing'}
                                        loading={testState.status === 'testing'}
                                        onClick={() => void runTest()}
                                    >
                                        Test export
                                    </Button>
                                </div>
                                {testState.status === 'done' && (
                                    <Alert
                                        variant={testState.result.ok ? 'success' : 'error'}
                                        message={telemetryTestMessage(testState.result, origin)}
                                    />
                                )}
                            </div>
                        </>
                    )}
                </section>
            ) : (
                <Alert variant="info" message="Your operator does not allow personal trace sinks." />
            )}

            {(config.allowUserSinks || config.operatorSink) && (
                <ChoiceGroup
                    name={`${id}-content`}
                    legend="Content level"
                    value={effective}
                    options={contentOptions}
                    onChange={contentLevel => onChange({ ...value, contentLevel })}
                />
            )}
        </div>
    );
}
