'use client';

import * as React from 'react';
import type { SkillSourceKind } from '@/lib/core/entity/assistant/skill';
import type { DocsIndexMetadata } from '@/lib/infrastructure/assistant/docs-index-format';
import type { SkillCatalogEntry } from '@/lib/infrastructure/assistant/skill-source';
import type { ImportUserSkillResult } from '@/lib/infrastructure/assistant/user-skills';
import { Alert } from '@/component-library/atoms/feedback/Alert';
import { Badge } from '@/component-library/atoms/misc/Badge';
import { Button } from '@/component-library/atoms/form/button';
import { Checkbox } from '@/component-library/atoms/form/checkbox';
import { Textarea } from '@/component-library/atoms/form/input';
import { cn } from '@/component-library/utils';

export const SOURCE_LABELS: Record<SkillSourceKind, string> = { shipped: 'Shipped', operator: 'Operator', user: 'User' };
const SOURCE_BADGE: Record<SkillSourceKind, 'neutral' | 'info' | 'warning'> = { shipped: 'neutral', operator: 'info', user: 'warning' };

export interface SkillsTabProps {
    entries: SkillCatalogEntry[];
    /** undefined while loading, null when the docs index metadata could not be read */
    docs: DocsIndexMetadata | null | undefined;
    onToggle(name: string, enabled: boolean): void;
    onImport(raw: string): ImportUserSkillResult;
    onDelete(name: string): void;
}

type ImportFeedback = { variant: 'success' | 'error'; message: string } | null;

/** FileReader instead of File.text(), which older test environments lack. */
function readFileText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
    });
}

function formatDate(iso: string): string {
    return iso.slice(0, 10);
}

function DocsVersion({ docs }: { docs: SkillsTabProps['docs'] }) {
    let text = 'Loading docs index details...';
    if (docs === null) text = 'Docs index details are not available.';
    if (docs) {
        text =
            `Rucio documentation ${docs.docsVersion.slice(0, 7)} (${formatDate(docs.docsCommitDate)}), ` +
            `REST API ${docs.openapiVersion}. Index built ${formatDate(docs.builtAt)}.`;
    }
    return (
        <section aria-labelledby="assistant-docs-index" className="flex flex-col gap-1">
            <h3 id="assistant-docs-index" className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                Docs index
            </h3>
            <p className="text-sm text-neutral-700 dark:text-neutral-300">{text}</p>
        </section>
    );
}

function collisionNote(entry: SkillCatalogEntry, entries: SkillCatalogEntry[]): string | null {
    if (entry.shadowedBy) {
        return `Hidden by the ${SOURCE_LABELS[entry.shadowedBy].toLowerCase()} skill with the same name.`;
    }
    const hidden = entries.filter(other => other.shadowedBy && other.skill.name === entry.skill.name);
    if (hidden.length === 0) return null;
    return `Replaces the ${hidden.map(h => SOURCE_LABELS[h.skill.source].toLowerCase()).join(' and ')} skill with the same name.`;
}

function SkillRow({
    entry,
    entries,
    onToggle,
    onDelete,
}: { entry: SkillCatalogEntry; entries: SkillCatalogEntry[] } & Pick<SkillsTabProps, 'onToggle' | 'onDelete'>) {
    const { skill } = entry;
    const id = `skill-${skill.source}-${skill.name}`;
    const note = collisionNote(entry, entries);
    return (
        <li
            className={cn(
                'flex flex-col gap-2 rounded-md border border-neutral-900/10 dark:border-neutral-100/10 p-3 sm:flex-row sm:items-start',
                entry.shadowedBy && 'opacity-60',
            )}
        >
            <Checkbox
                id={id}
                checked={entry.enabled}
                disabled={entry.shadowedBy !== undefined}
                onCheckedChange={checked => onToggle(skill.name, checked === true)}
                aria-label={`Enable ${skill.name}`}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor={id} className="font-medium text-neutral-900 dark:text-neutral-100 break-all">
                        {skill.name}
                    </label>
                    <Badge size="sm" variant={SOURCE_BADGE[skill.source]} value={SOURCE_LABELS[skill.source]} />
                </div>
                <p className="text-sm text-neutral-700 dark:text-neutral-300">{skill.description}</p>
                {skill.allowedTools && (
                    <p className="text-xs text-neutral-600 dark:text-neutral-400">Limits tools to: {skill.allowedTools.join(', ')}</p>
                )}
                {note && <p className="text-xs text-base-warning-700 dark:text-base-warning-400">{note}</p>}
            </div>
            {skill.source === 'user' && (
                <Button variant="error" size="sm" onClick={() => onDelete(skill.name)} aria-label={`Delete ${skill.name}`}>
                    Delete
                </Button>
            )}
        </li>
    );
}

export function SkillsTab({ entries, docs, onToggle, onImport, onDelete }: SkillsTabProps) {
    const [raw, setRaw] = React.useState('');
    const [feedback, setFeedback] = React.useState<ImportFeedback>(null);

    const runImport = (text: string) => {
        const result = onImport(text);
        if (result.ok) {
            const warnings = result.warnings.length > 0 ? ` ${result.warnings.join(' ')}` : '';
            setFeedback({ variant: 'success', message: `${result.replaced ? 'Replaced' : 'Imported'} ${result.skill.name}.${warnings}` });
            setRaw('');
        } else {
            setFeedback({ variant: 'error', message: `Could not import the skill: ${result.errors.join('; ')}.` });
        }
    };

    const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) runImport(await readFileText(file));
    };

    return (
        <div className="flex flex-col gap-6">
            <DocsVersion docs={docs} />

            <section aria-labelledby="assistant-skills" className="flex flex-col gap-3">
                <h3 id="assistant-skills" className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                    Skills
                </h3>
                <p className="text-sm text-neutral-700 dark:text-neutral-300">
                    Rucio bot reads a skill when a request matches it. Skills never change permissions. If two skills share a name, operator skills
                    win over shipped ones, and shipped ones over yours.
                </p>
                {entries.length === 0 ? (
                    <p className="text-sm text-neutral-700 dark:text-neutral-300">No skills available.</p>
                ) : (
                    <ul className="flex flex-col gap-2">
                        {entries.map(entry => (
                            <SkillRow
                                key={`${entry.skill.source}:${entry.skill.name}`}
                                entry={entry}
                                entries={entries}
                                onToggle={onToggle}
                                onDelete={onDelete}
                            />
                        ))}
                    </ul>
                )}
            </section>

            <section aria-labelledby="assistant-import-skill" className="flex flex-col gap-3">
                <h3 id="assistant-import-skill" className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                    Add your own skill
                </h3>
                <p className="text-sm text-neutral-700 dark:text-neutral-300">
                    Paste a SKILL.md or choose a .md file. It is stored in this browser only and is treated as untrusted text.
                </p>
                <label htmlFor="assistant-skill-markdown" className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    SKILL.md
                </label>
                <Textarea
                    id="assistant-skill-markdown"
                    value={raw}
                    rows={8}
                    onChange={event => setRaw(event.target.value)}
                    placeholder={'---\nname: my-skill\ndescription: What it does and when to use it.\n---\nInstructions'}
                />
                <div className="flex flex-wrap items-center gap-3">
                    <Button onClick={() => runImport(raw)} disabled={raw.trim() === ''}>
                        Import
                    </Button>
                    <input
                        type="file"
                        accept=".md,text/markdown,text/plain"
                        onChange={onFile}
                        aria-label="Import a SKILL.md file"
                        className="text-sm text-neutral-900 dark:text-neutral-100"
                    />
                </div>
                {feedback && <Alert variant={feedback.variant} message={feedback.message} onClose={() => setFeedback(null)} />}
            </section>
        </div>
    );
}
