import fs from 'fs';
import path from 'path';
import { createKnowledgeIndex } from '@/lib/infrastructure/assistant/knowledge-index';
import type { DocsIndexFile, DocsIndexMetaFile } from '@/lib/infrastructure/assistant/docs-index-format';

const root = path.resolve(__dirname, '../../..');
const readJson = <T>(relative: string): T => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')) as T;

interface DocsSources {
    documentation: { repo: string; ref: string; commitDate: string };
    openapi: { url: string; version: string; sha256: string };
}

describe('committed docs index (public/assistant)', () => {
    const sources = readJson<DocsSources>('tools/assistant/docs-sources.json');
    const meta = readJson<DocsIndexMetaFile>('public/assistant/docs-index.meta.json');
    const file = readJson<DocsIndexFile>('public/assistant/docs-index.json');

    it('was built from the pinned sources', () => {
        expect(sources.documentation.ref).toMatch(/^[0-9a-f]{40}$/);
        expect(meta.metadata).toMatchObject({
            docsVersion: sources.documentation.ref,
            docsCommitDate: sources.documentation.commitDate,
            openapiVersion: sources.openapi.version,
            openapiSha256: sources.openapi.sha256,
        });
        expect(file.metadata).toEqual(meta.metadata);
        expect(file.schemaVersion).toBe(1);
    });

    it('answers core Rucio questions with documentation links', async () => {
        const index = createKnowledgeIndex({ loadIndex: async () => file, loadMeta: async () => meta });
        const [expressions] = await index.search('rse expression operators', 3);
        expect(expressions.url).toBe('https://rucio.cern.ch/documentation/started/concepts/rse_expressions/#operators');
        const quota = await index.search('account quota limits', 3);
        expect(quota.map(hit => hit.url)).toContain('https://rucio.cern.ch/documentation/started/concepts/accounting_and_quota/');
        const api = await index.search('delete replication rule', 5);
        expect(api.some(hit => hit.source === 'openapi' && hit.title.startsWith('DELETE /rules/{rule_id}'))).toBe(true);
    });
});
