import { buildDocsIndex, type ChunkDraft } from '../../../tools/assistant/docs-index-lib';
import { createKnowledgeIndex, makeSnippet, SNIPPET_MAX, type KnowledgeIndexLoaders } from '@/lib/infrastructure/assistant/knowledge-index';
import type { DocsIndexMetadata } from '@/lib/infrastructure/assistant/docs-index-format';
import { createSearchDocsTool } from '@/lib/infrastructure/assistant/tools/search-docs-tool';
import type { ToolExecutionContext } from '@/lib/infrastructure/assistant/tool-types';

const metadata: Omit<DocsIndexMetadata, 'chunkCount'> = {
    docsVersion: '566bee0ff5471bab2c05e5fc0f9a77f7a5df2ecb',
    docsCommitDate: '2026-10-19T14:25:25Z',
    openapiVersion: '41.0.0rc1',
    openapiSha256: 'abc',
    builtAt: '2026-10-25T12:00:00.000Z',
    minisearchVersion: '7.2.0',
};

const drafts: ChunkDraft[] = [
    {
        title: 'RSE Expressions > Operators',
        text: 'Operators connect terms: union, intersection and complement of RSE sets.',
        excerpt: 'Operators connect terms: union, intersection and complement of RSE sets.',
        url: 'https://rucio.cern.ch/documentation/started/concepts/rse_expressions/#operators',
        source: 'docs',
    },
    {
        title: 'Accounting and quota',
        text: 'Quota is a policy limit which the system applies to an account.',
        excerpt: 'Quota is a policy limit which the system applies to an account.',
        url: 'https://rucio.cern.ch/documentation/started/concepts/accounting_and_quota/',
        source: 'docs',
    },
    {
        title: 'DELETE /rules/{rule_id} (Delete a replication rule)',
        text: 'Tags: Rule\nDelete a replication rule\nrule_id (path): The id of the replication rule.',
        excerpt: 'Tags: Rule\nDelete a replication rule',
        url: 'https://rucio.cern.ch/documentation/html/rest_api_doc.html',
        source: 'openapi',
    },
];

function fixtureLoaders(): KnowledgeIndexLoaders & { loadIndex: jest.Mock; loadMeta: jest.Mock } {
    const file = buildDocsIndex(drafts, metadata);
    return {
        loadIndex: jest.fn(async () => JSON.parse(JSON.stringify(file))),
        loadMeta: jest.fn(async () => ({ schemaVersion: 1 as const, metadata: file.metadata })),
    };
}

describe('createKnowledgeIndex', () => {
    it('loads lazily, once, and returns DocHits with source links', async () => {
        const loaders = fixtureLoaders();
        const index = createKnowledgeIndex(loaders);
        expect(loaders.loadIndex).not.toHaveBeenCalled();

        const hits = await index.search('rse expression operators', 5);
        await index.search('quota', 5);
        expect(loaders.loadIndex).toHaveBeenCalledTimes(1);
        expect(hits[0]).toEqual({
            title: 'RSE Expressions > Operators',
            snippet: drafts[0].excerpt,
            url: drafts[0].url,
            source: 'docs',
            score: expect.any(Number),
        });
    });

    it('falls back to 5 hits for a non-finite limit', async () => {
        const index = createKnowledgeIndex(fixtureLoaders());
        expect(await index.search('quota', Number.NaN)).toHaveLength(1);
        expect(await index.search('quota', Infinity)).toHaveLength(1);
    });

    it('finds OpenAPI operations and caps the number of hits', async () => {
        const index = createKnowledgeIndex(fixtureLoaders());
        const hits = await index.search('delete replication rule', 1);
        expect(hits).toHaveLength(1);
        expect(hits[0]).toMatchObject({ source: 'openapi', title: 'DELETE /rules/{rule_id} (Delete a replication rule)' });
        expect(await index.search('   ', 5)).toEqual([]);
    });

    it('retries after a failed load', async () => {
        const loaders = fixtureLoaders();
        loaders.loadIndex.mockRejectedValueOnce(new Error('offline'));
        const index = createKnowledgeIndex(loaders);
        await expect(index.search('quota', 5)).rejects.toThrow('offline');
        await expect(index.search('quota', 5)).resolves.toHaveLength(1);
    });

    it('rejects an index with another schema version', async () => {
        const loaders = fixtureLoaders();
        loaders.loadIndex.mockResolvedValueOnce({ schemaVersion: 2, metadata: {}, index: {} });
        await expect(createKnowledgeIndex(loaders).search('quota', 5)).rejects.toThrow('Unsupported docs index schema 2');
    });

    it('reads metadata from the small meta file until the index is loaded', async () => {
        const loaders = fixtureLoaders();
        const index = createKnowledgeIndex(loaders);
        expect(await index.metadata()).toEqual({ docsVersion: metadata.docsVersion, openapiVersion: '41.0.0rc1', builtAt: metadata.builtAt });
        expect(loaders.loadIndex).not.toHaveBeenCalled();
        expect(loaders.loadMeta).toHaveBeenCalledTimes(1);
        loaders.loadMeta.mockRejectedValueOnce(new Error('404'));
        expect(await createKnowledgeIndex(loaders).metadata()).toBeUndefined();
    });
});

describe('makeSnippet', () => {
    it('returns short excerpts as they are and centres long ones on the first match', () => {
        expect(makeSnippet('short text', 'text')).toBe('short text');
        const long = `${'a '.repeat(400)}quota limit ${'b '.repeat(400)}`;
        const snippet = makeSnippet(long, 'quota');
        expect(snippet).toContain('quota limit');
        expect(snippet.startsWith('...')).toBe(true);
        expect(snippet.endsWith('...')).toBe(true);
        expect(snippet.length).toBeLessThanOrEqual(SNIPPET_MAX + 6);
    });
});

describe('search_docs tool', () => {
    const ctx = {} as ToolExecutionContext;

    it('is an always-on read tool on the docs executor', () => {
        const { spec } = createSearchDocsTool(createKnowledgeIndex(fixtureLoaders()));
        expect(spec).toMatchObject({ name: 'search_docs', domain: 'core', risk: 'read', executor: 'docs', output: 'object', alwaysOn: true });
        expect(spec.requires).toEqual({ flags: [] });
        expect(spec.describeCall({ query: 'quota' })).toBe('Search the Rucio docs for "quota"');
        expect(spec.input.safeParse({ query: 'q' }).success).toBe(false);
        expect(spec.input.safeParse({ query: 'quota', limit: 9 }).success).toBe(false);
    });

    it('returns hits, and an unavailable error when the index cannot load', async () => {
        const tool = createSearchDocsTool(createKnowledgeIndex(fixtureLoaders()));
        const result = await tool.execute({ query: 'quota' }, ctx);
        expect(result).toMatchObject({ hits: [{ title: 'Accounting and quota' }] });

        const broken = createSearchDocsTool({ search: () => Promise.reject(new Error('404')), metadata: async () => undefined });
        expect(await broken.execute({ query: 'quota' }, ctx)).toEqual({ error: 'unavailable', message: 'The docs index could not be loaded: 404' });
    });
});
