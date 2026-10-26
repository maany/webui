import MiniSearch from 'minisearch';
import {
    buildDocsIndex,
    canonicalJson,
    chunkMarkdown,
    docRoute,
    extractRedocDefinition,
    headingAnchor,
    openapiChunks,
    readJsonObjectAt,
    toPlainText,
    MAX_CHUNK_CHARS,
} from '../../../tools/assistant/docs-index-lib';
import { DOCS_INDEX_OPTIONS, DOCS_SEARCH_OPTIONS, REST_API_DOC_URL, type DocsChunk } from '@/lib/infrastructure/assistant/docs-index-format';

describe('docRoute (Docusaurus URL rules)', () => {
    it.each([
        ['started/concepts/rse_expressions.md', {}, 'started/concepts/rse_expressions'],
        [
            'operator/policy_packages/policy_package_algorithms.md',
            { id: 'policy-package-algorithms' },
            'operator/policy_packages/policy-package-algorithms',
        ],
        ['developer/style_guide.md', { id: 'dev_style_guide' }, 'developer/dev_style_guide'],
        ['index.md', { id: 'index', slug: '/' }, ''],
        ['started/main_components/main_components.md', { id: 'main_components' }, 'started/main_components'],
        ['user/configuring_the_client.mdx', {}, 'user/configuring_the_client'],
        ['guides/01-intro.md', {}, 'guides/intro'],
        ['a/b.md', { slug: 'custom' }, 'a/custom'],
        ['a/b.md', { slug: '/top/level/' }, 'top/level'],
    ])('%s %j -> %s', (path, frontmatter, expected) => {
        expect(docRoute(path, frontmatter)).toBe(expected);
    });
});

describe('headingAnchor (github-slugger rules)', () => {
    it('matches Docusaurus heading ids', () => {
        const used = new Map<string, number>();
        expect(headingAnchor('What happens when a rule is stuck?', used).anchor).toBe('what-happens-when-a-rule-is-stuck');
        expect(headingAnchor('I want to have 2 replicas of first_dataset and second_dataset on Tier 1 RSEs', used).anchor).toBe(
            'i-want-to-have-2-replicas-of-first_dataset-and-second_dataset-on-tier-1-rses',
        );
        expect(headingAnchor('[Rule-based deletion](#rule-based-deletion)', used)).toEqual({
            text: 'Rule-based deletion',
            anchor: 'rule-based-deletion',
        });
        expect(headingAnchor('`RUCIO_ENABLE_SSL`', used).anchor).toBe('rucio_enable_ssl');
        expect(headingAnchor('**client** {#client_config}', used)).toEqual({ text: 'client', anchor: 'client_config' });
    });

    it('suffixes repeated headings like the slugger', () => {
        const used = new Map<string, number>();
        expect(headingAnchor('Examples', used).anchor).toBe('examples');
        expect(headingAnchor('Examples', used).anchor).toBe('examples-1');
        expect(headingAnchor('Examples', used).anchor).toBe('examples-2');
    });
});

describe('toPlainText', () => {
    it('drops MDX imports, JSX tags, fences and link targets but keeps code text', () => {
        const md = [
            "import Tabs from '@theme/Tabs';",
            '<Tabs>',
            'See [the guide](other.md).',
            '```bash',
            'rucio rule add',
            '```',
            ':::note',
            'Careful',
            ':::',
        ].join('\n');
        expect(toPlainText(md)).toBe('See the guide.\nrucio rule add\nCareful');
    });
});

describe('chunkMarkdown', () => {
    const page = [
        '---',
        'id: rse_expressions',
        'title: RSE Expressions',
        '---',
        'Intro about expressions.',
        '',
        '## Operators',
        'Union is tier=1|tier=2.',
        '```bash',
        '## not a heading inside a fence',
        '```',
        '<!-- ## Hidden heading -->',
        '### Composing',
        'Use parentheses.',
    ].join('\n');

    it('splits on h2 and h3 outside code fences and comments, with page and anchor URLs', () => {
        const chunks = chunkMarkdown('started/concepts/rse_expressions.md', page);
        expect(chunks.map(c => [c.title, c.url])).toEqual([
            ['RSE Expressions', 'https://rucio.cern.ch/documentation/started/concepts/rse_expressions/'],
            ['RSE Expressions > Operators', 'https://rucio.cern.ch/documentation/started/concepts/rse_expressions/#operators'],
            ['RSE Expressions > Composing', 'https://rucio.cern.ch/documentation/started/concepts/rse_expressions/#composing'],
        ]);
        expect(chunks[1].text).toContain('not a heading inside a fence');
        expect(chunks.some(c => c.title.includes('Hidden'))).toBe(false);
        expect(chunks.every(c => c.source === 'docs')).toBe(true);
    });

    it('falls back to the first h1 and splits long sections into parts', () => {
        const long = `# Big page\n\n## Section\n${Array.from({ length: 30 }, () => 'word '.repeat(60)).join('\n\n')}`;
        const chunks = chunkMarkdown('big.md', long);
        expect(chunks[0].title).toBe('Big page');
        const parts = chunks.filter(c => c.title.startsWith('Big page > Section'));
        expect(parts.length).toBeGreaterThan(1);
        expect(parts[0].title).toBe('Big page > Section (part 1)');
        expect(parts.every(p => p.text.length <= MAX_CHUNK_CHARS * 2)).toBe(true);
        expect(parts.every(p => p.excerpt.length <= 903)).toBe(true);
    });
});

describe('OpenAPI helpers', () => {
    const spec = {
        openapi: '3.0.2',
        info: { version: '41.0.0rc1', title: 'Rucio' },
        paths: {
            '/rules/{rule_id}': {
                parameters: [],
                get: {
                    summary: 'Return a Rule',
                    tags: ['Rule'],
                    parameters: [{ name: 'rule_id', in: 'path', description: 'The id of the replication rule.' }],
                },
                delete: { summary: 'Delete a replication rule', tags: ['Rule'], 'x-codeSamples': [{ lang: 'curl' }] },
            },
        },
    };

    it('makes one chunk per operation linking to the REST API page', () => {
        const chunks = openapiChunks(spec);
        expect(chunks.map(c => c.title)).toEqual(['GET /rules/{rule_id} (Return a Rule)', 'DELETE /rules/{rule_id} (Delete a replication rule)']);
        expect(chunks[0].text).toContain('rule_id (path): The id of the replication rule.');
        expect(chunks.every(c => c.url === REST_API_DOC_URL && c.source === 'openapi')).toBe(true);
    });

    it('extracts the Redoc definition, keeps standard keys and drops code samples', () => {
        const html = `<script>const __redoc_definition = ${JSON.stringify({
            TypeError: 'junk',
            ...spec,
        })}; const __redoc_options = {"x":"}"};</script>`;
        const extracted = extractRedocDefinition(html);
        expect(Object.keys(extracted).sort()).toEqual(['info', 'openapi', 'paths']);
        expect(JSON.stringify(extracted)).not.toContain('x-codeSamples');
        expect(() => extractRedocDefinition('<html></html>')).toThrow('__redoc_definition not found');
    });

    it('reads a JSON object with braces inside strings', () => {
        const text = 'x = {"a":"}{","b":{"c":"\\"}"}} trailing';
        expect(JSON.parse(readJsonObjectAt(text, 4))).toEqual({ a: '}{', b: { c: '"}' } });
    });

    it('hashes independently of key order', () => {
        expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
    });
});

describe('buildDocsIndex', () => {
    it('produces an index the browser options can load and search', () => {
        const file = buildDocsIndex(
            [
                {
                    title: 'RSE Expressions > Operators',
                    text: 'Union intersection complement of RSE sets',
                    excerpt: 'Union...',
                    url: 'u1',
                    source: 'docs',
                },
                { title: 'Accounting and quota', text: 'Quota is a policy limit for an account', excerpt: 'Quota...', url: 'u2', source: 'docs' },
            ],
            {
                docsVersion: 'abc',
                docsCommitDate: '2026-10-19T14:25:25Z',
                openapiVersion: '41.0.0rc1',
                openapiSha256: 'f00',
                builtAt: '2026-10-25T00:00:00.000Z',
                minisearchVersion: '7.2.0',
            },
        );
        expect(file.schemaVersion).toBe(1);
        expect(file.metadata.chunkCount).toBe(2);
        const search = MiniSearch.loadJS<DocsChunk>(JSON.parse(JSON.stringify(file.index)), DOCS_INDEX_OPTIONS);
        const [top] = search.search('how do quota limits work', DOCS_SEARCH_OPTIONS);
        expect(top).toMatchObject({ title: 'Accounting and quota', url: 'u2', source: 'docs', excerpt: 'Quota...' });
    });
});

describe('identifiers and operators survive plain-text conversion', () => {
    it('keeps underscores, pipes, globs, exports and placeholders', () => {
        const md = [
            'Use rse_expression with first_dataset and RUCIO_ENABLE_SSL.',
            'Union is tier=1|tier=2 and scope:* matches all; **bold** and _it_ are emphasis.',
            'Call `did_name` or `**x**` literally.',
            '| a | b |',
            '|---|---|',
            '| c_d | e |',
            '```bash',
            'export RUCIO_ACCOUNT=root',
            'rucio list-dids <did> --filter "tier=1|tier=2" scope:*',
            'import foo_bar',
            '```',
        ].join('\n');
        const text = toPlainText(md);
        expect(text).toContain('Use rse_expression with first_dataset and RUCIO_ENABLE_SSL.');
        expect(text).toContain('Union is tier=1|tier=2 and scope:* matches all; bold and it are emphasis.');
        expect(text).toContain('Call did_name or **x** literally.');
        expect(text).toContain('c_d');
        expect(text).not.toContain('|---');
        expect(text).not.toMatch(/^\s*\|/m);
        expect(text).toContain('export RUCIO_ACCOUNT=root');
        expect(text).toContain('rucio list-dids <did> --filter "tier=1|tier=2" scope:*');
        expect(text).toContain('import foo_bar');
        expect(text).not.toContain('```');
    });

    it('keeps underscores in heading titles and anchors', () => {
        const used = new Map<string, number>();
        expect(headingAnchor('`RUCIO_ENABLE_SSL`', used)).toEqual({ text: 'RUCIO_ENABLE_SSL', anchor: 'rucio_enable_ssl' });
        expect(headingAnchor('The _emphasis_ and snake_case', new Map())).toEqual({
            text: 'The emphasis and snake_case',
            anchor: 'the-emphasis-and-snake_case',
        });
    });

    it('keeps identifiers in chunk titles and text', () => {
        const chunks = chunkMarkdown('a.md', '# Page\n\n## `RUCIO_ENABLE_SSL`\nSet rse_expression.');
        expect(chunks[1].title).toBe('Page > RUCIO_ENABLE_SSL');
        expect(chunks[1].text).toBe('Set rse_expression.');
    });

    it('does not strip comments or take the h1 title from inside code fences', () => {
        const md = ['```md', '# Fake title', '<!-- keep -->', '```', '', '# Real title', '', 'Body <!-- gone --> text.'].join('\n');
        const [first] = chunkMarkdown('x.md', md);
        expect(first.title).toBe('Real title');
        expect(first.text).toContain('<!-- keep -->');
        expect(first.text).not.toContain('gone');
    });
});

describe('headingAnchor repeated slugs', () => {
    it('records suffixed slugs so later headings never collide', () => {
        const used = new Map<string, number>();
        expect(['Examples', 'Examples 1', 'Examples'].map(h => headingAnchor(h, used).anchor)).toEqual(['examples', 'examples-1', 'examples-2']);
    });
});

describe('em dash normalisation', () => {
    it('replaces U+2014 in text, titles and code, but keeps the anchor Docusaurus would generate', () => {
        const dash = String.fromCharCode(0x2014);
        const drafts = chunkMarkdown(
            'a.md',
            `---\ntitle: Page ${dash} one\n---\n\n## Foo ${dash} bar\n\nSome ${dash} text\n\n\`\`\`\nx ${dash} y\n\`\`\`\n`,
        );
        const json = JSON.stringify(drafts);
        expect(json).not.toContain(dash);
        expect(drafts[0].title).toBe('Page - one > Foo - bar');
        expect(drafts[0].text).toContain('Some - text');
        expect(drafts[0].text).toContain('x - y');
        expect(drafts[0].url).toMatch(/#foo--bar$/);
    });
});
