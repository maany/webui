import fs from 'fs';
import path from 'path';
import { loadDocsIndexMetadata } from '@/lib/infrastructure/assistant/docs-index-meta';
import { DOCS_INDEX_META_PUBLIC_PATH, DOCS_INDEX_SCHEMA_VERSION, type DocsIndexMetadata } from '@/lib/infrastructure/assistant/docs-index-format';

const metadata: DocsIndexMetadata = {
    docsVersion: '566bee0ff5471bab2c05e5fc0f9a77f7a5df2ecb',
    docsCommitDate: '2026-10-19T14:25:25Z',
    openapiVersion: '41.0.0rc1',
    openapiSha256: 'abc',
    builtAt: '2026-10-25T12:00:00.000Z',
    chunkCount: 3,
    minisearchVersion: '7.2.0',
};

describe('loadDocsIndexMetadata', () => {
    const realFetch = global.fetch;
    afterEach(() => {
        global.fetch = realFetch;
    });

    it('reads the meta file from its public path', async () => {
        const fetchMock = jest.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ schemaVersion: DOCS_INDEX_SCHEMA_VERSION, metadata }),
        }));
        global.fetch = fetchMock as unknown as typeof fetch;
        await expect(loadDocsIndexMetadata()).resolves.toEqual(metadata);
        expect(fetchMock).toHaveBeenCalledWith(DOCS_INDEX_META_PUBLIC_PATH, { credentials: 'same-origin' });
    });

    it('returns undefined on a wrong schema, a bad status or a network error, and never throws', async () => {
        global.fetch = jest.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ schemaVersion: 99, metadata }),
        })) as unknown as typeof fetch;
        await expect(loadDocsIndexMetadata()).resolves.toBeUndefined();
        global.fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch;
        await expect(loadDocsIndexMetadata()).resolves.toBeUndefined();
        global.fetch = jest.fn(async () => {
            throw new Error('offline');
        }) as unknown as typeof fetch;
        await expect(loadDocsIndexMetadata()).resolves.toBeUndefined();
    });

    it('does not import minisearch at runtime', () => {
        const source = fs.readFileSync(path.resolve(__dirname, '../../../src/lib/infrastructure/assistant/docs-index-meta.ts'), 'utf8');
        expect(source).not.toMatch(/^import (?!type)[^;]*from 'minisearch'/m);
        expect(source).not.toMatch(/knowledge-index/);
    });
});
