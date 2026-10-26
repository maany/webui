import fs from 'fs';
import path from 'path';
import { SHIPPED_SKILLS } from '@/lib/infrastructure/assistant/skills/shipped-skills.generated';
import { parseSkillMarkdown } from '@/lib/infrastructure/assistant/skills/skill-md';

const root = path.resolve(__dirname, '../../..');
const skillsDir = path.join(root, 'src/lib/infrastructure/assistant/skills');
const featureDir = path.join(root, 'src/app/api/feature');

/** Core tools from phases 2, 3 and 5 (no route directory). */
const CORE_TOOLS = ['find_tools', 'navigate', 'read_current_page', 'page_action', 'search_docs', 'run_sql', 'refresh_handle', 'activate_skill'];
/** Route tools planned in phase 7 that may land after this phase. */
const PLANNED_TOOLS = ['list_requests'];
/** Route directories that are not tools (same list as phase 2's read-tool-registry test). */
const NOT_TOOLS = new Set(['template-stream', 'get-assistant-config']);

/** Phase 2 (reads), phase 4 (writes) and phase 7 name feature tools after their route directory in snake case. */
function routeToolNames(): string[] {
    return fs
        .readdirSync(featureDir)
        .filter(dir => !dir.startsWith('mock-') && !NOT_TOOLS.has(dir))
        .map(dir => dir.replace(/-/g, '_'));
}

describe('shipped skills', () => {
    const dirs = fs
        .readdirSync(skillsDir)
        .filter(entry => fs.statSync(path.join(skillsDir, entry)).isDirectory())
        .sort();

    it('ships the five v1 skills', () => {
        expect(dirs).toEqual([
            'creating-replication-rules',
            'diagnosing-stuck-rules',
            'quota-and-usage-analysis',
            'rse-expression-basics',
            'sql-recipes-over-handles',
        ]);
    });

    it('generated module matches the SKILL.md files (run npm run assistant:build-skills if this fails)', () => {
        const parsed = dirs.map(dir => {
            const result = parseSkillMarkdown(fs.readFileSync(path.join(skillsDir, dir, 'SKILL.md'), 'utf8'), { source: 'shipped', dirName: dir });
            if (!result.ok) throw new Error(`${dir}: ${result.errors.join('; ')}`);
            return result.skill;
        });
        expect(SHIPPED_SKILLS).toEqual(parsed);
    });

    it('only allows tools that exist', () => {
        const known = new Set([...routeToolNames(), ...CORE_TOOLS, ...PLANNED_TOOLS]);
        for (const skill of SHIPPED_SKILLS) {
            const unknown = (skill.allowedTools ?? []).filter(tool => !known.has(tool));
            expect({ skill: skill.name, unknown }).toEqual({ skill: skill.name, unknown: [] });
            expect(skill.allowedTools).toContain('find_tools');
            expect(skill.allowedTools).toContain('search_docs');
        }
    });

    it('stays within the Agent Skills size guidance and avoids em dashes', () => {
        for (const skill of SHIPPED_SKILLS) {
            expect(skill.body.split('\n').length).toBeLessThan(200);
            expect(skill.description.length).toBeLessThanOrEqual(1024);
            expect(`${skill.description}\n${skill.body}`).not.toContain('—');
        }
    });
});
