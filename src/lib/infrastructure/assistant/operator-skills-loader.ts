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
    for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        if (skills.length >= MAX_OPERATOR_SKILLS) {
            logger.warn(
                `[assistant] Skipping operator skills: more than ${MAX_OPERATOR_SKILLS} skills in ${root}; ${
                    entries.length - index
                } more entries ignored`,
            );
            break;
        }
        const label = JSON.stringify(entry.slice(0, 80));
        const skip = (reason: string) =>
            logger.warn(`[assistant] Skipping operator skill ${label}: ${reason.replace(CONTROL_CHARS, ' ').slice(0, MAX_REASON_LENGTH)}`);
        const skillDir = path.join(root, entry);
        const file = path.join(skillDir, 'SKILL.md');
        try {
            if (!(await fs.stat(skillDir)).isDirectory()) continue;
            const stat = await fs.stat(file);
            if (!stat.isFile()) {
                skip('SKILL.md is not a regular file');
                continue;
            }
            const tooLarge = `SKILL.md is larger than ${MAX_SKILL_BYTES / 1024} KB`;
            if (stat.size > MAX_SKILL_BYTES) {
                skip(tooLarge);
                continue;
            }
            const raw = await readBounded(file);
            if (raw === undefined) {
                skip(tooLarge);
                continue;
            }
            const result = parseSkillMarkdown(raw, { source: 'operator', dirName: entry });
            if (!result.ok) {
                skip(result.errors.join('; '));
                continue;
            }
            skills.push(result.skill);
        } catch (error) {
            skip(error instanceof Error ? error.message : String(error));
        }
    }
    return skills;
}

const MAX_REASON_LENGTH = 300;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** Reads at most MAX_SKILL_BYTES; returns undefined when the file holds more. Never reads unbounded input. */
async function readBounded(file: string): Promise<string | undefined> {
    const handle = await fs.open(file, 'r');
    try {
        const buffer = Buffer.alloc(MAX_SKILL_BYTES + 1);
        let total = 0;
        while (total < buffer.length) {
            const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
            if (bytesRead === 0) break;
            total += bytesRead;
        }
        if (total > MAX_SKILL_BYTES) return undefined;
        return buffer.toString('utf8', 0, total);
    } finally {
        await handle.close();
    }
}
