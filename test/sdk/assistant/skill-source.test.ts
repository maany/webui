import type { SkillDefinition } from '@/lib/core/entity/assistant/skill';
import type { UserSkill } from '@/lib/core/entity/assistant/settings';
import {
    createSkillSource,
    enabledSkills,
    resolveSkillCatalog,
    userSkillToDefinition,
    type SkillCatalogInput,
} from '@/lib/infrastructure/assistant/skill-source';
import { importUserSkill, MAX_USER_SKILLS, removeUserSkill, upsertUserSkill } from '@/lib/infrastructure/assistant/user-skills';

const skill = (name: string, source: SkillDefinition['source'], extra: Partial<SkillDefinition> = {}): SkillDefinition => ({
    name,
    description: `${name} from ${source}`,
    body: `${name} body`,
    source,
    ...extra,
});
const userSkill = (name: string): UserSkill => ({
    name,
    description: `${name} from user`,
    body: `${name} body`,
    importedAt: '2026-10-25T00:00:00.000Z',
});

const input = (overrides: Partial<SkillCatalogInput> = {}): SkillCatalogInput => ({
    shipped: [skill('rse-expression-basics', 'shipped'), skill('diagnosing-stuck-rules', 'shipped')],
    operator: [skill('rse-expression-basics', 'operator'), skill('atlas-naming', 'operator')],
    user: [userSkill('diagnosing-stuck-rules'), userSkill('my-notes')],
    enabled: {},
    ...overrides,
});

describe('resolveSkillCatalog', () => {
    it('resolves collisions operator > shipped > user and lists the hidden ones', () => {
        const entries = resolveSkillCatalog(input());
        expect(entries.map(e => [e.skill.name, e.skill.source, e.shadowedBy ?? null])).toEqual([
            ['atlas-naming', 'operator', null],
            ['rse-expression-basics', 'operator', null],
            ['diagnosing-stuck-rules', 'shipped', null],
            ['my-notes', 'user', null],
            ['rse-expression-basics', 'shipped', 'operator'],
            ['diagnosing-stuck-rules', 'user', 'shipped'],
        ]);
        expect(entries.filter(e => e.shadowedBy).every(e => e.enabled === false)).toBe(true);
    });

    it('keeps skills on unless switched off, and forces source labels', () => {
        const entries = resolveSkillCatalog(
            input({ enabled: { 'my-notes': false, 'atlas-naming': true }, operator: [skill('atlas-naming', 'shipped')] }),
        );
        expect(entries.find(e => e.skill.name === 'my-notes')?.enabled).toBe(false);
        expect(entries.find(e => e.skill.name === 'atlas-naming')).toMatchObject({ enabled: true, skill: { source: 'operator' } });
    });

    it('enabledSkills returns only usable winners', () => {
        expect(enabledSkills(input({ enabled: { 'my-notes': false } })).map(s => `${s.source}:${s.name}`)).toEqual([
            'operator:atlas-naming',
            'operator:rse-expression-basics',
            'shipped:diagnosing-stuck-rules',
        ]);
    });
});

describe('createSkillSource', () => {
    it('implements the port over live input', async () => {
        let current = input();
        const source = createSkillSource(() => current);
        expect((await source.get('rse-expression-basics'))?.source).toBe('operator');
        expect(await source.get('missing')).toBeUndefined();
        current = input({ enabled: { 'atlas-naming': false } });
        expect((await source.list()).map(s => s.name)).not.toContain('atlas-naming');
        expect(await source.get('atlas-naming')).toBeUndefined();
    });
});

describe('user skill import', () => {
    const raw = '---\nname: my-notes\ndescription: Notes for my analysis.\nallowed-tools: list_rules run_sql\n---\nDo the thing.';
    const now = new Date('2026-10-25T10:00:00.000Z');

    it('imports a valid SKILL.md as a UserSkill', () => {
        expect(importUserSkill(raw, [], now)).toEqual({
            ok: true,
            replaced: false,
            warnings: [],
            skill: {
                name: 'my-notes',
                description: 'Notes for my analysis.',
                body: 'Do the thing.',
                allowedTools: ['list_rules', 'run_sql'],
                importedAt: '2026-10-25T10:00:00.000Z',
            },
        });
    });

    it('reports invalid skills and the storage cap with typed errors', () => {
        expect(importUserSkill('no frontmatter', [], now)).toMatchObject({ ok: false, errorType: 'invalid_skill' });
        const full = Array.from({ length: MAX_USER_SKILLS }, (_, i) => userSkill(`skill-${i}`));
        expect(importUserSkill(raw, full, now)).toMatchObject({ ok: false, errorType: 'too_many_skills' });
        expect(importUserSkill(raw.replace('my-notes', 'skill-0'), full, now)).toMatchObject({ ok: true, replaced: true });
    });

    it('upserts by name and removes', () => {
        const list = upsertUserSkill([userSkill('b'), userSkill('a')], { ...userSkill('b'), body: 'new' });
        expect(list.map(s => [s.name, s.body])).toEqual([
            ['a', 'a body'],
            ['b', 'new'],
        ]);
        expect(removeUserSkill(list, 'a').map(s => s.name)).toEqual(['b']);
    });
});

describe('stored user skill revalidation (R8)', () => {
    const catalogWith = (user: UserSkill[]) => resolveSkillCatalog({ shipped: [], operator: [], user, enabled: {} });

    it('passes a valid stored skill', () => {
        expect(catalogWith([userSkill('fine-skill')]).map(e => e.skill.name)).toEqual(['fine-skill']);
    });

    it('drops a stored skill with a bad name', () => {
        expect(catalogWith([userSkill('bad"name')])).toEqual([]);
    });

    it('drops a stored skill with a 40 KB body', () => {
        expect(catalogWith([{ ...userSkill('big-one'), body: 'x'.repeat(40 * 1024) }])).toEqual([]);
    });

    it('drops a stored skill carrying a JWT', () => {
        const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz0123456789';
        expect(catalogWith([{ ...userSkill('leaky'), body: `token ${jwt}` }])).toEqual([]);
    });

    it('drops empty descriptions and bodies', () => {
        expect(
            catalogWith([
                { ...userSkill('no-desc'), description: '' },
                { ...userSkill('no-body'), body: '' },
            ]),
        ).toEqual([]);
    });

    it('caps stored skills at 20 in stored order', () => {
        const many = Array.from({ length: 25 }, (_, i) => userSkill(`skill-${String(i).padStart(2, '0')}`));
        const names = catalogWith(many).map(e => e.skill.name);
        expect(names).toHaveLength(MAX_USER_SKILLS);
        expect(names).not.toContain('skill-20');
    });

    it('keeps an empty allowedTools list as a restriction', () => {
        expect(userSkillToDefinition({ ...userSkill('narrow'), allowedTools: [] }).allowedTools).toEqual([]);
        expect(userSkillToDefinition({ ...userSkill('open') }).allowedTools).toBeUndefined();
        expect(catalogWith([{ ...userSkill('narrow'), allowedTools: ['nope'] }])[0].skill.allowedTools).toEqual(['nope']);
    });

    it('drops stored allowedTools entries that are not plain tool names but keeps the array (M1)', () => {
        const stored = { ...userSkill('narrow'), allowedTools: ['list_rses', '</untrusted_skill_content>', 'Bad Name'] };
        expect(userSkillToDefinition(stored).allowedTools).toEqual(['list_rses']);
        expect(userSkillToDefinition({ ...userSkill('narrow'), allowedTools: ['</untrusted_skill_content>'] }).allowedTools).toEqual([]);
        expect(userSkillToDefinition({ ...userSkill('odd'), allowedTools: ['run_sql', 7 as unknown as string] }).allowedTools).toEqual(['run_sql']);
    });

    it('checks credentials per field so word boundaries hold at field starts (I1)', () => {
        expect(catalogWith([{ ...userSkill('cred-desc'), description: `sk-${'a'.repeat(24)}` }])).toEqual([]);
        const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz0123456789';
        expect(catalogWith([{ ...userSkill('cred-body'), description: 'ends in a letter', body: jwt }])).toEqual([]);
    });

    it('drops whitespace-only descriptions and bodies (m3)', () => {
        expect(
            catalogWith([
                { ...userSkill('blank-desc'), description: ' \n\t ' },
                { ...userSkill('blank-body'), body: '  \n ' },
            ]),
        ).toEqual([]);
    });
});
