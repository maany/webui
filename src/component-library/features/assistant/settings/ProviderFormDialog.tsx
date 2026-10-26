'use client';

import * as React from 'react';
import { MutationDialog } from '@/component-library/features/mutations/MutationDialog';
import { FormField, describedBy } from '@/component-library/features/mutations/FormField';
import { Input } from '@/component-library/atoms/form/input';
import { Alert } from '@/component-library/atoms/feedback/Alert';
import type { ByokProviderKind, ProviderConfig } from '@/lib/core/entity/assistant/provider-config';
import { lookupModel } from '@/lib/infrastructure/assistant/model-catalog';
import {
    DEFAULT_BASE_URLS,
    KIND_NEEDS_API_KEY,
    KIND_NEEDS_BASE_URL,
    PROVIDER_KIND_DESCRIPTIONS,
    PROVIDER_KIND_LABELS,
} from '@/lib/infrastructure/assistant/provider-kinds';
import { ChoiceGroup } from './ChoiceGroup';
import {
    draftFromProvider,
    emptyProviderDraft,
    providerFromDraft,
    validateProviderDraft,
    type ProviderDraft,
    type ProviderDraftErrors,
} from './provider-draft';

export interface ProviderFormDialogProps {
    allowedKinds: ByokProviderKind[];
    /** The provider to edit; omit to add a new one. */
    initial?: ProviderConfig;
    onSave(provider: ProviderConfig): void;
    onClose(): void;
    newId(): string;
}

const ID = 'assistant-provider';
const KEY_WARNING =
    'API keys are stored in plain text in this browser and sent only to the provider, never to the Rucio WebUI server. Prefer a key with a spending limit.';
const MODEL_PLACEHOLDERS: Record<ByokProviderKind, string> = {
    anthropic: 'claude-sonnet-5-5',
    openai: 'gpt-5.4-mini',
    'openai-compatible': 'gpt-oss-120b',
    ollama: 'qwen3',
};

function baseUrlHint(kind: ByokProviderKind): string {
    if (kind === 'openai-compatible') return 'Usually ends in /v1.';
    if (kind === 'ollama') return 'Leave empty for http://localhost:11434.';
    return 'Leave empty to use the default.';
}

/** Add or edit dialog. Always open: the parent mounts it with a new `key` per opening and unmounts it on close. */
export const ProviderFormDialog: React.FC<ProviderFormDialogProps> = ({ allowedKinds, initial, onSave, onClose, newId }) => {
    const [draft, setDraft] = React.useState<ProviderDraft>(() =>
        initial ? draftFromProvider(initial) : emptyProviderDraft(allowedKinds[0] ?? 'openai-compatible'),
    );
    const [errors, setErrors] = React.useState<ProviderDraftErrors>({});
    const kinds = initial && !allowedKinds.includes(initial.kind) ? [...allowedKinds, initial.kind] : allowedKinds;
    const known = draft.model.trim() ? lookupModel(draft.model) : undefined;

    const handleSubmit = () => {
        const found = validateProviderDraft(draft);
        setErrors(found);
        if (Object.keys(found).length > 0) return;
        onSave(providerFromDraft(draft, initial?.id ?? newId()));
        onClose();
    };

    const textField = (
        name: Exclude<keyof ProviderDraft, 'kind'>,
        label: string,
        options: {
            type?: 'text' | 'password' | 'url';
            placeholder?: string;
            hint?: string;
            required?: boolean;
            inputMode?: 'numeric' | 'decimal';
        } = {},
    ) => {
        const id = `${ID}-${name}`;
        return (
            <FormField id={id} label={label} required={options.required} error={errors[name]} hint={options.hint}>
                <Input
                    id={id}
                    type={options.type ?? 'text'}
                    value={draft[name]}
                    onChange={event => setDraft(current => ({ ...current, [name]: event.target.value }))}
                    placeholder={options.placeholder}
                    inputMode={options.inputMode}
                    autoComplete="off"
                    spellCheck={false}
                    error={Boolean(errors[name])}
                    aria-describedby={describedBy(id, { error: errors[name], hint: options.hint })}
                />
            </FormField>
        );
    };

    return (
        <MutationDialog
            open
            onOpenChange={open => {
                if (!open) onClose();
            }}
            title={initial ? 'Edit provider' : 'Add provider'}
            description="Rucio bot calls this provider directly from your browser."
            onSubmit={handleSubmit}
            submitLabel="Save provider"
        >
            <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
                <ChoiceGroup
                    name={`${ID}-kind`}
                    legend="Provider type"
                    layout="stack"
                    value={draft.kind}
                    options={kinds.map(kind => ({
                        value: kind,
                        label: PROVIDER_KIND_LABELS[kind],
                        description: PROVIDER_KIND_DESCRIPTIONS[kind],
                        disabled: !allowedKinds.includes(kind),
                    }))}
                    onChange={kind => setDraft(current => ({ ...current, kind }))}
                />
                {textField('label', 'Name', { required: true, placeholder: 'My provider' })}
                {textField('baseURL', 'Base URL', {
                    type: 'url',
                    required: KIND_NEEDS_BASE_URL[draft.kind],
                    placeholder: DEFAULT_BASE_URLS[draft.kind] ?? 'https://litellm.example.org/v1',
                    hint: baseUrlHint(draft.kind),
                })}
                {textField('apiKey', 'API key', {
                    type: 'password',
                    required: KIND_NEEDS_API_KEY[draft.kind],
                    hint: KIND_NEEDS_API_KEY[draft.kind] ? undefined : 'Optional.',
                })}
                <Alert variant="warning" message={KEY_WARNING} />
                {textField('model', 'Model', {
                    required: true,
                    placeholder: MODEL_PLACEHOLDERS[draft.kind],
                    hint: known?.contextWindow
                        ? `Known model, ${known.contextWindow.toLocaleString('en-US')} token context.`
                        : 'The model must support tool calling.',
                })}
                {textField('contextWindow', 'Context window (tokens)', { inputMode: 'numeric', hint: 'Leave empty for known models.' })}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {textField('inputPerMTok', 'Input price (USD per million tokens)', { inputMode: 'decimal', hint: 'Optional.' })}
                    {textField('outputPerMTok', 'Output price (USD per million tokens)', { inputMode: 'decimal', hint: 'Optional.' })}
                </div>
            </div>
        </MutationDialog>
    );
};
