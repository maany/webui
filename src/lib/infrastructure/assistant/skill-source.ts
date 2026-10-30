import type { SkillDefinition, SkillSourceKind } from '@/lib/core/entity/assistant/skill';
import type { UserSkill } from '@/lib/core/entity/assistant/settings';
import type { AssistantSkillSourcePort } from '@/lib/core/port/secondary/assistant-skill-source-port';
import {
    containsCredential,
    MAX_SKILL_BYTES,
    MAX_SKILL_DESCRIPTION_LENGTH,
    MAX_SKILL_NAME_LENGTH,
    SKILL_NAME_RE,
    TOOL_NAME_RE,
    utf8Length,
} from '@/lib/infrastructure/assistant/skills/skill-md';
import { MAX_USER_SKILLS } from '@/lib/infrastructure/assistant/user-skills';

/** Collision order: a skill from an earlier source hides a later one with the same name. */
export const SKILL_SOURCE_PRECEDENCE: readonly SkillSourceKind[] = ['operator', 'shipped', 'user'];

export interface SkillCatalogInput {
    shipped: SkillDefinition[];
    operator: SkillDefinition[];
    user: UserSkill[];
    enabled: Record<string, boolean>;
}

export interface SkillCatalogEntry {
    skill: SkillDefinition;
    /** False when the user switched the skill off; skills are on unless `enabled[name] === false`. */
    enabled: boolean;
    /** Set when another source owns this name; the entry is listed in settings but never offered to the bot. */
    shadowedBy?: SkillSourceKind;
}

export function userSkillToDefinition(skill: UserSkill): SkillDefinition {
    const definition: SkillDefinition = { name: skill.name, description: skill.description, body: skill.body, source: 'user' };
    // A present array is a restriction, even an empty one: never widen it to "no restriction".
    // Entries that are not plain tool names are dropped (stored text is untrusted and reaches the model).
    if (Array.isArray(skill.allowedTools))
        definition.allowedTools = skill.allowedTools.filter(tool => typeof tool === 'string' && TOOL_NAME_RE.test(tool));
    return definition;
}

/** localStorage is not trusted: stored user skills are revalidated where they are used. */
function isUsableUserSkill(skill: UserSkill): boolean {
    return (
        typeof skill.name === 'string' &&
        typeof skill.description === 'string' &&
        typeof skill.body === 'string' &&
        SKILL_NAME_RE.test(skill.name) &&
        skill.name.length <= MAX_SKILL_NAME_LENGTH &&
        skill.description.trim().length > 0 &&
        skill.description.length <= MAX_SKILL_DESCRIPTION_LENGTH &&
        skill.body.trim().length > 0 &&
        utf8Length(skill.body) <= MAX_SKILL_BYTES &&
        ![
            skill.name,
            skill.description,
            skill.body,
            ...(Array.isArray(skill.allowedTools) ? skill.allowedTools.filter(t => typeof t === 'string') : []),
        ].some(containsCredential)
    );
}

/**
 * Every known skill with its state, winners first in precedence order (operator, shipped, user), each
 * group sorted by name, followed by shadowed duplicates.
 */
export function resolveSkillCatalog(input: SkillCatalogInput): SkillCatalogEntry[] {
    const bySource: Record<SkillSourceKind, SkillDefinition[]> = {
        operator: input.operator.map(s => ({ ...s, source: 'operator' as const })),
        shipped: input.shipped.map(s => ({ ...s, source: 'shipped' as const })),
        user: input.user.filter(isUsableUserSkill).slice(0, MAX_USER_SKILLS).map(userSkillToDefinition),
    };
    const owner = new Map<string, SkillSourceKind>();
    const winners: SkillCatalogEntry[] = [];
    const shadowed: SkillCatalogEntry[] = [];
    for (const source of SKILL_SOURCE_PRECEDENCE) {
        const sorted = [...bySource[source]].sort((a, b) => a.name.localeCompare(b.name));
        for (const skill of sorted) {
            const existing = owner.get(skill.name);
            if (existing) {
                shadowed.push({ skill, enabled: false, shadowedBy: existing });
                continue;
            }
            owner.set(skill.name, source);
            winners.push({ skill, enabled: input.enabled[skill.name] !== false });
        }
    }
    return [...winners, ...shadowed];
}

/** Skills the bot may use: winners that are switched on. */
export function enabledSkills(input: SkillCatalogInput): SkillDefinition[] {
    return resolveSkillCatalog(input)
        .filter(entry => entry.enabled && !entry.shadowedBy)
        .map(entry => entry.skill);
}

/** AssistantSkillSourcePort over live inputs; `read` is called on every list/get so settings changes apply at once. */
export function createSkillSource(read: () => SkillCatalogInput): AssistantSkillSourcePort {
    return {
        async list() {
            return enabledSkills(read());
        },
        async get(name: string) {
            return enabledSkills(read()).find(skill => skill.name === name);
        },
    };
}
