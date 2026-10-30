'use client';

import * as React from 'react';
import { Button } from '@/component-library/atoms/form/button';
import { Alert } from '@/component-library/atoms/feedback/Alert';
import { Badge } from '@/component-library/atoms/misc/Badge';
import { MutationDialog } from '@/component-library/features/mutations/MutationDialog';
import { cn } from '@/component-library/utils';
import type { AssistantConfig } from '@/lib/core/entity/assistant/assistant-config';
import type { AssistantSettings } from '@/lib/core/entity/assistant/settings';
import type { ModelPricing, ProviderConfig, ResolvedProvider } from '@/lib/core/entity/assistant/provider-config';
import { resolveActiveProvider, type ResolveProviderError } from '@/lib/core/services/assistant-provider';
import { lookupModel } from '@/lib/infrastructure/assistant/model-catalog';
import { ASSISTANT_RELAY_BASE_URL, PROVIDER_KIND_LABELS } from '@/lib/infrastructure/assistant/provider-kinds';
import type { ConnectionTestResult } from '@/lib/infrastructure/assistant/connection-test';
import { ChoiceGroup, type ChoiceOption } from './ChoiceGroup';
import { ProviderFormDialog } from './ProviderFormDialog';

export const PROVIDER_ERROR_TEXT: Record<ResolveProviderError, string> = {
    'no-provider': 'No provider is selected.',
    'byok-disabled': 'Your operator has turned off personal providers.',
    'kind-not-allowed': 'Your operator does not allow this provider type.',
};

const KEY_STORAGE_OPTIONS: ChoiceOption<AssistantSettings['keyStorage']>[] = [
    { value: 'local', label: 'On this device', description: 'Keys stay in this browser until you delete them.' },
    { value: 'session', label: 'This tab only', description: 'Keys are removed when you close the tab. Other tabs ask for them again.' },
];

export interface ProvidersTabProps {
    config: AssistantConfig;
    settings: AssistantSettings;
    onUpdate(patch: (settings: AssistantSettings) => AssistantSettings): void;
    onTestConnection(resolved: ResolvedProvider, signal?: AbortSignal): Promise<ConnectionTestResult>;
    newId(): string;
}

type TestState = { status: 'testing' } | { status: 'done'; result: ConnectionTestResult };

function priceText(pricing: ModelPricing | undefined): string {
    return pricing ? `$${pricing.inputPerMTok} in, $${pricing.outputPerMTok} out per million tokens` : 'No price';
}

interface ProviderCardProps {
    title: string;
    subtitle: string;
    detail: string;
    active: boolean;
    badges?: React.ReactNode;
    actions: React.ReactNode;
    test?: TestState;
}

const ProviderCard: React.FC<ProviderCardProps> = ({ title, subtitle, detail, active, badges, actions, test }) => (
    <li
        aria-label={title}
        className={cn(
            'flex flex-col gap-3 rounded-lg border bg-neutral-0 p-4 dark:bg-neutral-900',
            active ? 'border-brand-500 dark:border-brand-400' : 'border-neutral-200 dark:border-neutral-700',
        )}
    >
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-neutral-900 dark:text-neutral-100 wrap-break-word">{title}</span>
                    {active && <Badge variant="success" size="sm" value="Active" />}
                    {badges}
                </div>
                <p className="text-sm text-neutral-600 dark:text-neutral-400 break-all">{subtitle}</p>
                <p className="text-xs text-neutral-600 dark:text-neutral-400">{detail}</p>
            </div>
            <div className="flex flex-wrap gap-2">{actions}</div>
        </div>
        {test?.status === 'done' &&
            (test.result.ok ? (
                <Alert variant="success" message={`Connected in ${test.result.latencyMs} ms.`} />
            ) : (
                <Alert variant="error" message={test.result.hint} />
            ))}
    </li>
);

export const ProvidersTab: React.FC<ProvidersTabProps> = ({ config, settings, onUpdate, onTestConnection, newId }) => {
    const [form, setForm] = React.useState<{ key: number; initial?: ProviderConfig } | null>(null);
    const [pendingDelete, setPendingDelete] = React.useState<ProviderConfig | null>(null);
    const [tests, setTests] = React.useState<Record<string, TestState>>({});
    const formKey = React.useRef(0);

    const operator = config.defaultProvider;
    const active = resolveActiveProvider(settings, config, ASSISTANT_RELAY_BASE_URL, lookupModel);
    const activeError = 'error' in active ? active.error : undefined;
    const hasOptions = Boolean(operator) || (config.allowByok && settings.providers.length > 0);

    const choose = (id: string) => onUpdate(s => ({ ...s, activeProviderId: id }));

    const controllers = React.useRef(new Map<string, AbortController>());

    React.useEffect(() => {
        const map = controllers.current;
        return () => {
            map.forEach(controller => controller.abort());
            map.clear();
        };
    }, []);

    // Drops the running test and the shown result of a provider that changed or was removed.
    const discardTest = (id: string) => {
        controllers.current.get(id)?.abort();
        controllers.current.delete(id);
        setTests(current => {
            if (!(id in current)) return current;
            const rest = { ...current };
            delete rest[id];
            return rest;
        });
    };

    const save = (provider: ProviderConfig) => {
        discardTest(provider.id);
        onUpdate(s => {
            const exists = s.providers.some(p => p.id === provider.id);
            const providers = exists ? s.providers.map(p => (p.id === provider.id ? provider : p)) : [...s.providers, provider];
            const activeProviderId = !exists && s.activeProviderId === 'operator' && !config.defaultProvider ? provider.id : s.activeProviderId;
            return { ...s, providers, activeProviderId };
        });
    };

    const remove = (id: string) => {
        discardTest(id);
        onUpdate(s => {
            const providers = s.providers.filter(p => p.id !== id);
            let activeProviderId = s.activeProviderId;
            if (activeProviderId === id) {
                const next = config.allowByok ? providers.find(p => config.allowedProviderKinds.includes(p.kind)) : undefined;
                activeProviderId = config.defaultProvider ? 'operator' : next?.id ?? 'operator';
            }
            return { ...s, providers, activeProviderId };
        });
    };

    const runTest = async (id: string) => {
        const resolved = resolveActiveProvider({ ...settings, activeProviderId: id }, config, ASSISTANT_RELAY_BASE_URL, lookupModel);
        controllers.current.get(id)?.abort();
        const controller = new AbortController();
        controllers.current.set(id, controller);
        setTests(current => ({ ...current, [id]: { status: 'testing' } }));
        let result: ConnectionTestResult;
        if ('error' in resolved) {
            result = { ok: false, code: 'unknown', hint: PROVIDER_ERROR_TEXT[resolved.error] };
        } else {
            try {
                result = await onTestConnection(resolved, controller.signal);
            } catch {
                result = { ok: false, code: 'unknown', hint: 'The connection test failed unexpectedly. Try again.' };
            }
        }
        if (controller.signal.aborted) return;
        controllers.current.delete(id);
        setTests(current => ({ ...current, [id]: { status: 'done', result } }));
    };

    const openForm = (initial?: ProviderConfig) => {
        formKey.current += 1;
        setForm({ key: formKey.current, initial });
    };

    return (
        <section aria-labelledby="assistant-providers-heading" className="space-y-6">
            <h2 id="assistant-providers-heading" className="sr-only">
                Providers
            </h2>

            {activeError && hasOptions && (
                <Alert
                    variant="warning"
                    message={`Rucio bot cannot use your active provider. ${PROVIDER_ERROR_TEXT[activeError]} Choose another one below.`}
                />
            )}
            {!hasOptions && (
                <Alert
                    variant="info"
                    message={
                        config.allowByok
                            ? 'No model is set up yet. Add a provider to start using Rucio bot.'
                            : 'No model is set up yet. Ask your Rucio operator to configure one.'
                    }
                />
            )}

            {operator && (
                <div className="space-y-3">
                    <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Operator default</h3>
                    <ul className="space-y-3">
                        <ProviderCard
                            title={operator.label}
                            subtitle={`${PROVIDER_KIND_LABELS[operator.kind]} · ${operator.model}`}
                            detail="Provided by your Rucio operator. The key stays on the server."
                            active={settings.activeProviderId === 'operator'}
                            badges={<Badge variant="info" size="sm" value="Operator default" />}
                            test={tests.operator}
                            actions={
                                <>
                                    {settings.activeProviderId !== 'operator' && (
                                        <Button size="sm" onClick={() => choose('operator')} aria-label={`Use ${operator.label}`}>
                                            Use
                                        </Button>
                                    )}
                                    <Button
                                        size="sm"
                                        variant="neutral"
                                        loading={tests.operator?.status === 'testing'}
                                        onClick={() => runTest('operator')}
                                        aria-label={`Test connection for ${operator.label}`}
                                    >
                                        Test connection
                                    </Button>
                                </>
                            }
                        />
                    </ul>
                </div>
            )}

            {config.allowByok ? (
                <div className="space-y-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Your providers</h3>
                        <Button size="sm" onClick={() => openForm()}>
                            Add provider
                        </Button>
                    </div>
                    <p className="text-sm text-neutral-600 dark:text-neutral-400">
                        Use your own API key. Calls go straight from your browser to the provider.
                    </p>
                    <ChoiceGroup
                        name="assistant-key-storage"
                        legend="Where to keep API keys"
                        value={settings.keyStorage}
                        options={KEY_STORAGE_OPTIONS}
                        onChange={keyStorage => onUpdate(s => ({ ...s, keyStorage }))}
                    />
                    <ul className="space-y-3">
                        {settings.providers.map(provider => {
                            const allowed = config.allowedProviderKinds.includes(provider.kind);
                            const isActive = settings.activeProviderId === provider.id;
                            return (
                                <ProviderCard
                                    key={provider.id}
                                    title={provider.label}
                                    subtitle={`${PROVIDER_KIND_LABELS[provider.kind]} · ${provider.model}`}
                                    detail={priceText(provider.pricing ?? lookupModel(provider.model)?.pricing)}
                                    active={isActive}
                                    badges={allowed ? undefined : <Badge variant="warning" size="sm" value="Not allowed by the operator" />}
                                    test={tests[provider.id]}
                                    actions={
                                        <>
                                            {!isActive && (
                                                <Button
                                                    size="sm"
                                                    disabled={!allowed}
                                                    onClick={() => choose(provider.id)}
                                                    aria-label={`Use ${provider.label}`}
                                                >
                                                    Use
                                                </Button>
                                            )}
                                            <Button
                                                size="sm"
                                                variant="neutral"
                                                disabled={!allowed}
                                                loading={tests[provider.id]?.status === 'testing'}
                                                onClick={() => runTest(provider.id)}
                                                aria-label={`Test connection for ${provider.label}`}
                                            >
                                                Test connection
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="neutral"
                                                onClick={() => openForm(provider)}
                                                aria-label={`Edit ${provider.label}`}
                                            >
                                                Edit
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="error"
                                                onClick={() => setPendingDelete(provider)}
                                                aria-label={`Delete ${provider.label}`}
                                            >
                                                Delete
                                            </Button>
                                        </>
                                    }
                                />
                            );
                        })}
                    </ul>
                </div>
            ) : (
                operator && <Alert variant="info" message="Your operator has turned off personal providers. Rucio bot uses the operator default." />
            )}

            {pendingDelete && (
                <MutationDialog
                    open
                    onOpenChange={open => {
                        if (!open) setPendingDelete(null);
                    }}
                    title="Delete provider"
                    description="This removes the provider and its API key from this browser."
                    onSubmit={() => {
                        remove(pendingDelete.id);
                        setPendingDelete(null);
                    }}
                    submitLabel="Delete provider"
                    submitVariant="error"
                >
                    <p className="text-sm text-neutral-900 dark:text-neutral-100">{pendingDelete.label}</p>
                </MutationDialog>
            )}

            {form && (
                <ProviderFormDialog
                    key={form.key}
                    initial={form.initial}
                    allowedKinds={config.allowedProviderKinds}
                    onSave={save}
                    onClose={() => setForm(null)}
                    newId={newId}
                />
            )}
        </section>
    );
};
