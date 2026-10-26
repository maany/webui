'use client';

import * as React from 'react';
import type { AssistantConfig } from '@/lib/core/entity/assistant/assistant-config';
import type { AssistantSettings } from '@/lib/core/entity/assistant/settings';
import type { DocsIndexMetadata } from '@/lib/infrastructure/assistant/docs-index-format';
import { SkillsTab } from '@/component-library/features/assistant/settings/SkillsTab';
import { knowledgeIndex } from '@/lib/infrastructure/assistant/knowledge-index';
import { resolveSkillCatalog } from '@/lib/infrastructure/assistant/skill-source';
import { SHIPPED_SKILLS } from '@/lib/infrastructure/assistant/skills/shipped-skills.generated';
import { importUserSkill, removeUserSkill, upsertUserSkill } from '@/lib/infrastructure/assistant/user-skills';

export interface SkillsTabContainerProps {
    config: AssistantConfig;
    settings: AssistantSettings;
    onUpdate(patch: (settings: AssistantSettings) => AssistantSettings): void;
}

/** Reads the small docs-index.meta.json once; null when it cannot be read. */
function useDocsIndexMetadata(): DocsIndexMetadata | null | undefined {
    const [docs, setDocs] = React.useState<DocsIndexMetadata | null | undefined>(undefined);
    React.useEffect(() => {
        let active = true;
        knowledgeIndex.fullMetadata().then(metadata => {
            if (active) setDocs(metadata ?? null);
        });
        return () => {
            active = false;
        };
    }, []);
    return docs;
}

export function SkillsTabContainer({ config, settings, onUpdate }: SkillsTabContainerProps) {
    const docs = useDocsIndexMetadata();
    const entries = React.useMemo(
        () =>
            resolveSkillCatalog({
                shipped: SHIPPED_SKILLS,
                operator: config.operatorSkills,
                user: settings.skills.user,
                enabled: settings.skills.enabled,
            }),
        [config.operatorSkills, settings.skills.user, settings.skills.enabled],
    );

    return (
        <SkillsTab
            entries={entries}
            docs={docs}
            onToggle={(name, enabled) => onUpdate(s => ({ ...s, skills: { ...s.skills, enabled: { ...s.skills.enabled, [name]: enabled } } }))}
            onImport={raw => {
                const result = importUserSkill(raw, settings.skills.user);
                if (result.ok) {
                    onUpdate(s => ({ ...s, skills: { ...s.skills, user: upsertUserSkill(s.skills.user, result.skill) } }));
                }
                return result;
            }}
            onDelete={name =>
                onUpdate(s => {
                    const enabled = { ...s.skills.enabled };
                    // Keep the switch when a shipped or operator skill still uses this name.
                    if (!entries.some(e => e.skill.name === name && e.skill.source !== 'user')) delete enabled[name];
                    return { ...s, skills: { enabled, user: removeUserSkill(s.skills.user, name) } };
                })
            }
        />
    );
}
