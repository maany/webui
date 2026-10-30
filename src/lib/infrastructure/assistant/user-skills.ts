import type { UserSkill } from '@/lib/core/entity/assistant/settings';
import { parseSkillMarkdown } from '@/lib/infrastructure/assistant/skills/skill-md';

/** User skills live in localStorage, so their number is capped. */
export const MAX_USER_SKILLS = 20;

export type ImportUserSkillErrorType = 'invalid_skill' | 'too_many_skills';

export type ImportUserSkillResult =
    | { ok: true; skill: UserSkill; replaced: boolean; warnings: string[] }
    | { ok: false; errorType: ImportUserSkillErrorType; errors: string[] };

/**
 * Validates a pasted or uploaded SKILL.md and returns the UserSkill to store.
 * Importing a name that already exists replaces that user skill.
 */
export function importUserSkill(raw: string, existing: UserSkill[], now: Date = new Date()): ImportUserSkillResult {
    const parsed = parseSkillMarkdown(raw, { source: 'user' });
    if (!parsed.ok) return { ok: false, errorType: 'invalid_skill', errors: parsed.errors };
    const replaced = existing.some(s => s.name === parsed.skill.name);
    if (!replaced && existing.length >= MAX_USER_SKILLS) {
        return { ok: false, errorType: 'too_many_skills', errors: [`You can keep at most ${MAX_USER_SKILLS} skills. Delete one first.`] };
    }
    const skill: UserSkill = {
        name: parsed.skill.name,
        description: parsed.skill.description,
        body: parsed.skill.body,
        importedAt: now.toISOString(),
    };
    if (parsed.skill.allowedTools) skill.allowedTools = parsed.skill.allowedTools;
    return { ok: true, skill, replaced, warnings: parsed.warnings };
}

/** Returns the list with `skill` added, or replacing the user skill of the same name. */
export function upsertUserSkill(existing: UserSkill[], skill: UserSkill): UserSkill[] {
    const others = existing.filter(s => s.name !== skill.name);
    return [...others, skill].sort((a, b) => a.name.localeCompare(b.name));
}

export function removeUserSkill(existing: UserSkill[], name: string): UserSkill[] {
    return existing.filter(s => s.name !== name);
}
