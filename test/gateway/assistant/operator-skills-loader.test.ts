import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadOperatorSkills, MAX_OPERATOR_DIR_ENTRIES, MAX_OPERATOR_SKILLS } from '@/lib/infrastructure/assistant/operator-skills-loader';
import { MAX_SKILL_BYTES } from '@/lib/infrastructure/assistant/skills/skill-md';

const skillMd = (name: string, extra = '') =>
    `---\nname: ${name}\ndescription: ${name} instructions for operators.\n${extra}---\n# ${name}\n\nDo it.\n`;

describe('operator skills loader', () => {
    let dir: string;
    const logger = { warn: jest.fn() };

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-skills-'));
        logger.warn.mockClear();
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    function addSkill(dirName: string, content: string) {
        fs.mkdirSync(path.join(dir, dirName));
        fs.writeFileSync(path.join(dir, dirName, 'SKILL.md'), content);
    }

    it('returns no skills when the variable is unset or the directory is missing', async () => {
        expect(await loadOperatorSkills(undefined, logger)).toEqual([]);
        expect(await loadOperatorSkills('  ', logger)).toEqual([]);
        expect(await loadOperatorSkills(path.join(dir, 'missing'), logger)).toEqual([]);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('cannot be read'));
    });

    it('loads valid skills sorted by directory, with operator source and allowed tools', async () => {
        addSkill('b-skill', skillMd('b-skill', 'allowed-tools: list_rules run_sql\n'));
        addSkill('a-skill', skillMd('a-skill'));
        fs.writeFileSync(path.join(dir, 'README.md'), 'not a skill dir');
        fs.mkdirSync(path.join(dir, '.hidden'));
        expect(await loadOperatorSkills(dir, logger)).toEqual([
            { name: 'a-skill', description: 'a-skill instructions for operators.', body: '# a-skill\n\nDo it.', source: 'operator' },
            {
                name: 'b-skill',
                description: 'b-skill instructions for operators.',
                body: '# b-skill\n\nDo it.',
                allowedTools: ['list_rules', 'run_sql'],
                source: 'operator',
            },
        ]);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('skips invalid, mismatched, oversized and SKILL.md-less directories with a log line', async () => {
        addSkill('good', skillMd('good'));
        addSkill('mismatch', skillMd('other-name'));
        addSkill('no-description', '---\nname: no-description\n---\nBody\n');
        addSkill('too-big', `${skillMd('too-big')}${'x'.repeat(MAX_SKILL_BYTES)}`);
        fs.mkdirSync(path.join(dir, 'empty'));
        const skills = await loadOperatorSkills(dir, logger);
        expect(skills.map(s => s.name)).toEqual(['good']);
        const messages = logger.warn.mock.calls.map(call => call[0] as string);
        expect(messages).toEqual([
            expect.stringContaining('Skipping operator skill "empty"'),
            expect.stringContaining('Skipping operator skill "mismatch": name "other-name" must match its directory "mismatch"'),
            expect.stringContaining('Skipping operator skill "no-description": description is required'),
            expect.stringContaining('Skipping operator skill "too-big": SKILL.md is larger than 32 KB'),
        ]);
    });

    it('skips a skill holding a credential without echoing its content', async () => {
        addSkill('leaky', skillMd('leaky') + '-----BEGIN RSA PRIVATE KEY-----\nabc\n');
        addSkill('good', skillMd('good'));
        const skills = await loadOperatorSkills(dir, logger);
        expect(skills.map(s => s.name)).toEqual(['good']);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        const message = logger.warn.mock.calls[0][0] as string;
        expect(message).toContain('[assistant] Skipping operator skill "leaky"');
        expect(message).not.toContain('BEGIN RSA');
    });

    it(`serves at most ${MAX_OPERATOR_SKILLS} skills`, async () => {
        for (let i = 0; i <= MAX_OPERATOR_SKILLS; i++)
            addSkill(`skill-${String(i).padStart(3, '0')}`, skillMd(`skill-${String(i).padStart(3, '0')}`));
        const skills = await loadOperatorSkills(dir, logger);
        expect(skills).toHaveLength(MAX_OPERATOR_SKILLS);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(`more than ${MAX_OPERATOR_SKILLS} skills`));
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('1 more entries ignored'));
        expect(skills.map(s => s.name)).not.toContain('skill-050');
    });

    it('warns when the root is a file', async () => {
        const file = path.join(dir, 'plain-file');
        fs.writeFileSync(file, 'x');
        expect(await loadOperatorSkills(file, logger)).toEqual([]);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('is not a directory'));
    });

    it('skips a SKILL.md that is a directory', async () => {
        fs.mkdirSync(path.join(dir, 'odd'));
        fs.mkdirSync(path.join(dir, 'odd', 'SKILL.md'));
        expect(await loadOperatorSkills(dir, logger)).toEqual([]);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Skipping operator skill "odd": SKILL.md is not a regular file'));
    });

    it('skips a symlinked SKILL.md that points to an oversized file outside the directory', async () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-outside-'));
        try {
            fs.writeFileSync(path.join(outside, 'big.md'), 'x'.repeat(MAX_SKILL_BYTES + 10));
            fs.mkdirSync(path.join(dir, 'linked'));
            fs.symlinkSync(path.join(outside, 'big.md'), path.join(dir, 'linked', 'SKILL.md'));
            expect(await loadOperatorSkills(dir, logger)).toEqual([]);
            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Skipping operator skill "linked": SKILL.md is larger than 32 KB'));
        } finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });

    (process.platform === 'win32' ? it.skip : it)(
        'skips a FIFO SKILL.md without hanging',
        async () => {
            fs.mkdirSync(path.join(dir, 'fifo'));
            execFileSync('mkfifo', [path.join(dir, 'fifo', 'SKILL.md')]);
            expect(await loadOperatorSkills(dir, logger)).toEqual([]);
            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Skipping operator skill "fifo": SKILL.md is not a regular file'));
        },
        3000,
    );

    it('renders entry names as escaped JSON so they cannot forge log lines', async () => {
        addSkill('evil\nname', skillMd('x'));
        await loadOperatorSkills(dir, logger);
        const message = logger.warn.mock.calls[0][0] as string;
        expect(message).not.toContain('\n');
        expect(message).toContain('"evil\\nname"');
    });

    it('stops after MAX_OPERATOR_DIR_ENTRIES directory entries, valid skills or not (M3)', async () => {
        addSkill('first-skill', skillMd('first-skill'));
        for (let i = 0; i < MAX_OPERATOR_DIR_ENTRIES + 1; i++) fs.writeFileSync(path.join(dir, `loose-${String(i).padStart(4, '0')}.txt`), 'x');
        const skills = await loadOperatorSkills(dir, logger);
        expect(skills.map(s => s.name)).toEqual(['first-skill']);
        const messages = logger.warn.mock.calls.map(call => String(call[0])).filter(m => m.includes(String(MAX_OPERATOR_DIR_ENTRIES)));
        expect(messages).toHaveLength(1);
    });
});
