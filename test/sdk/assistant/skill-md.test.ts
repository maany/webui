import {
    MAX_SKILL_BYTES,
    containsCredential,
    parseAllowedTools,
    parseFrontmatterBlock,
    parseSkillMarkdown,
    splitFrontmatter,
    utf8Length,
} from '@/lib/infrastructure/assistant/skills/skill-md';

const valid = [
    '---',
    'name: rse-expression-basics',
    'description: Write and test RSE expressions: operators, attributes.',
    'allowed-tools: list_rses search_docs',
    'metadata:',
    '  author: rucio',
    '  version: "1.0"',
    '---',
    '# RSE expressions',
    '',
    'Body text.',
].join('\n');

describe('frontmatter reader', () => {
    it('splits frontmatter and body, tolerating a BOM', () => {
        expect(splitFrontmatter(`\uFEFF${valid}`)?.body.trim()).toBe('# RSE expressions\n\nBody text.');
        expect(splitFrontmatter('# no frontmatter')).toBeNull();
    });

    it('reads plain, quoted, folded, literal, list and map values', () => {
        const block = [
            'title: "Quoted: value"',
            "single: 'it''s'",
            'folded: >',
            '  one',
            '  two',
            'literal: |',
            '  line 1',
            '  line 2',
            'list:',
            '  - a',
            '  - "b"',
            'map:',
            '  k: v',
            'url: https://example.org/a:b',
        ].join('\n');
        expect(parseFrontmatterBlock(block)).toEqual({
            title: 'Quoted: value',
            single: "it's",
            folded: 'one two',
            literal: 'line 1\nline 2',
            list: ['a', 'b'],
            map: { k: 'v' },
            url: 'https://example.org/a:b',
        });
    });
});

describe('parseAllowedTools', () => {
    it('accepts the spec space separated form, lists and commas, and dedupes', () => {
        expect(parseAllowedTools('list_rses  search_docs list_rses')).toEqual(['list_rses', 'search_docs']);
        expect(parseAllowedTools(['run_sql', 'list_rules'])).toEqual(['run_sql', 'list_rules']);
        expect(parseAllowedTools('[run_sql, "list_rules"]')).toEqual(['run_sql', 'list_rules']);
        expect(parseAllowedTools('')).toBeUndefined();
        expect(parseAllowedTools(undefined)).toBeUndefined();
    });
});

describe('parseSkillMarkdown', () => {
    it('parses a valid skill', () => {
        const result = parseSkillMarkdown(valid, { source: 'shipped', dirName: 'rse-expression-basics' });
        expect(result).toEqual({
            ok: true,
            warnings: [],
            skill: {
                name: 'rse-expression-basics',
                description: 'Write and test RSE expressions: operators, attributes.',
                body: '# RSE expressions\n\nBody text.',
                allowedTools: ['list_rses', 'search_docs'],
                source: 'shipped',
            },
        });
    });

    it.each([
        ['uppercase', 'PDF-Processing'],
        ['leading hyphen', '-pdf'],
        ['trailing hyphen', 'pdf-'],
        ['double hyphen', 'pdf--processing'],
        ['underscore', 'pdf_processing'],
        ['too long', 'a'.repeat(65)],
    ])('rejects a name with %s', (_label, name) => {
        const result = parseSkillMarkdown(valid.replace('name: rse-expression-basics', `name: ${name}`), { source: 'user' });
        expect(result.ok).toBe(false);
    });

    it('requires the name to match the directory when one is given', () => {
        const result = parseSkillMarkdown(valid, { source: 'operator', dirName: 'other-dir' });
        expect(result).toEqual({ ok: false, errors: ['name "rse-expression-basics" must match its directory "other-dir"'] });
    });

    it('requires frontmatter, a description and a body', () => {
        expect(parseSkillMarkdown('# Title only', { source: 'user' })).toEqual({
            ok: false,
            errors: ['SKILL.md must start with a frontmatter block between --- lines'],
        });
        const noDescription = parseSkillMarkdown('---\nname: a-skill\n---\nBody', { source: 'user' });
        expect(noDescription).toEqual({ ok: false, errors: ['description is required'] });
        const noBody = parseSkillMarkdown('---\nname: a-skill\ndescription: Does a thing.\n---\n', { source: 'user' });
        expect(noBody).toEqual({ ok: false, errors: ['the skill body after the frontmatter is empty'] });
    });

    it('enforces description and compatibility lengths', () => {
        const longDescription = valid.replace(/^description: .*$/m, `description: ${'d'.repeat(1025)}`);
        expect(parseSkillMarkdown(longDescription, { source: 'user' })).toEqual({
            ok: false,
            errors: ['description must be at most 1024 characters'],
        });
        const longCompat = valid.replace('allowed-tools:', `compatibility: ${'c'.repeat(501)}\nallowed-tools:`);
        expect(parseSkillMarkdown(longCompat, { source: 'user' })).toEqual({
            ok: false,
            errors: ['compatibility must be text of at most 500 characters'],
        });
    });

    it('rejects files over the size limit, counting UTF-8 bytes', () => {
        expect(utf8Length('a\u00e9\u20ac\u{1F600}')).toBe(1 + 2 + 3 + 4);
        const big = `${valid}\n${'\u00e9'.repeat(MAX_SKILL_BYTES / 2)}`;
        expect(parseSkillMarkdown(big, { source: 'user' })).toEqual({ ok: false, errors: ['SKILL.md is larger than 32 KB'] });
    });

    it('warns about bodies longer than 500 lines', () => {
        const long = `${valid}\n${Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n')}`;
        const result = parseSkillMarkdown(long, { source: 'user' });
        expect(result.ok && result.warnings).toEqual(['the body has more than 500 lines; consider shortening it']);
    });

    it('omits allowedTools when the field is absent', () => {
        const result = parseSkillMarkdown(valid.replace(/^allowed-tools: .*\n/m, ''), { source: 'user' });
        expect(result.ok && 'allowedTools' in result.skill).toBe(false);
    });
});

describe('credential guard', () => {
    const withBody = (text: string) => `${valid}\n\n${text}`;
    const jwt = `eyJ${'a'.repeat(12)}.${'b'.repeat(12)}.${'c'.repeat(12)}`;
    it.each([
        ['PEM private key', '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----'],
        ['PEM private key without algorithm', '-----BEGIN PRIVATE KEY-----'],
        ['JWT', `token ${jwt}`],
        ['sk- key', `key sk-${'A1'.repeat(12)}`],
        ['sk-ant- key', `key sk-ant-${'x'.repeat(24)}`],
        ['AWS access key id', 'id AKIAABCDEFGHIJKLMNOP'],
        ['Bearer token', `Authorization: Bearer ${'t'.repeat(24)}`],
        ['Rucio auth header', 'X-Rucio-Auth-Token: abcdef123456'],
        ['Rucio auth header, lowercase', 'x-rucio-auth-token: abcdef123456'],
    ])('detects a %s', (_label, text) => {
        expect(containsCredential(text)).toBe(true);
        expect(parseSkillMarkdown(withBody(text), { source: 'user' })).toEqual({
            ok: false,
            errors: ['SKILL.md looks like it contains a credential (an API key, token or private key); remove it first'],
        });
    });

    it('lets plain text mentioning API keys and tokens through', () => {
        const text = 'Never paste an API key or a token into chat. The Bearer scheme and sk- prefixes are explained elsewhere.';
        expect(containsCredential(text)).toBe(false);
        expect(parseSkillMarkdown(withBody(text), { source: 'user' }).ok).toBe(true);
    });
});

describe('frontmatter hardening', () => {
    it('does not let __proto__, constructor or prototype keys touch prototypes', () => {
        const parsed = parseFrontmatterBlock('__proto__:\n  polluted: yes\nconstructor: x\nprototype: y\nname: ok');
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        expect(Object.keys(parsed)).toEqual(['name']);
    });

    it('folds indented continuation lines of a plain scalar', () => {
        const block = 'description: First part of a long\n  wrapped description that\n  keeps going.\nname: a-skill';
        expect(parseFrontmatterBlock(block)).toEqual({
            description: 'First part of a long wrapped description that keeps going.',
            name: 'a-skill',
        });
    });

    it('unescapes a double backslash in double-quoted values', () => {
        expect(parseFrontmatterBlock('path: "C:\\\\dir"')).toEqual({ path: 'C:\\dir' });
    });

    it('accepts empty frontmatter and names the missing fields', () => {
        expect(splitFrontmatter('---\n---\nBody')).toEqual({ frontmatter: '', body: 'Body' });
        const result = parseSkillMarkdown('---\n---\n', { source: 'user' });
        expect(result).toEqual({
            ok: false,
            errors: ['name is required', 'description is required', 'the skill body after the frontmatter is empty'],
        });
    });

    it('wraps a long description without truncating it in a full skill', () => {
        const raw = '---\nname: a-skill\ndescription: Does a thing that\n  needs two lines.\n---\nBody';
        const result = parseSkillMarkdown(raw, { source: 'user' });
        expect(result.ok && result.skill.description).toBe('Does a thing that needs two lines.');
    });
});

describe('X-Rucio-Auth-Token placeholders are not credentials', () => {
    it.each([
        'X-Rucio-Auth-Token: <token>',
        'X-Rucio-Auth-Token: $TOKEN',
        'X-Rucio-Auth-Token: `value`',
        'X-Rucio-Auth-Token:\nnext line is long enough',
        'send the X-Rucio-Auth-Token: header',
    ])('passes %j', text => {
        expect(containsCredential(text)).toBe(false);
    });
});
