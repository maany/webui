import fs from 'fs/promises';
import path from 'path';
import type { SkillDefinition } from '@/lib/core/entity/assistant/skill';
import { MAX_SKILL_BYTES, parseSkillMarkdown } from '@/lib/infrastructure/assistant/skills/skill-md';

/** At most this many operator skills are served; extra directories are skipped with a warning. */
export const MAX_OPERATOR_SKILLS = 50;

export interface OperatorSkillsLogger {
    warn(message: string): void;
}

/**
 * Loads operator skills from `dir`: every subdirectory holding a SKILL.md, name equal to the directory name.
 * Invalid, oversized or unreadable skills are skipped with a server log line; the directory never breaks the config route.
 */
export async function loadOperatorSkills(dir: string | undefined, logger: OperatorSkillsLogger = console): Promise<SkillDefinition[]> {
    if (dir === undefined || dir.trim() === '') return [];
    const root = path.resolve(dir.trim());
    let entries: string[];
    try {
        const stat = await fs.stat(root);
        if (!stat.isDirectory()) {
            logger.warn(`[assistant] ASSISTANT_SKILLS_DIR ${root} is not a directory; no operator skills loaded`);
            return [];
        }
        entries = (await fs.readdir(root)).filter(name => !name.startsWith('.')).sort();
    } catch (error) {
        logger.warn(
            `[assistant] ASSISTANT_SKILLS_DIR ${root} cannot be read (${
                error instanceof Error ? error.message : String(error)
            }); no operator skills loaded`,
        );
        return [];
    }

    const skills: SkillDefinition[] = [];
    for (const entry of entries) {
        const skillDir = path.join(root, entry);
        const file = path.join(skillDir, 'SKILL.md');
        try {
            if (!(await fs.stat(skillDir)).isDirectory()) continue;
            const stat = await fs.stat(file);
            if (stat.size > MAX_SKILL_BYTES) {
                logger.warn(`[assistant] Skipping operator skill "${entry}": SKILL.md is larger than ${MAX_SKILL_BYTES / 1024} KB`);
                continue;
            }
            if (skills.length >= MAX_OPERATOR_SKILLS) {
                logger.warn(`[assistant] Skipping operator skill "${entry}": more than ${MAX_OPERATOR_SKILLS} skills in ${root}`);
                continue;
            }
            const result = parseSkillMarkdown(await fs.readFile(file, 'utf8'), { source: 'operator', dirName: entry });
            if (!result.ok) {
                logger.warn(`[assistant] Skipping operator skill "${entry}": ${result.errors.join('; ')}`);
                continue;
            }
            skills.push(result.skill);
        } catch (error) {
            logger.warn(`[assistant] Skipping operator skill "${entry}": ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return skills;
}
