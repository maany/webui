/**
 * Shared format of the assistant docs index (public/assistant/docs-index.json).
 * Imported by the build script (tools/assistant/build-docs-index.ts, run with Node type stripping)
 * and by the browser adapter (knowledge-index.ts), so it must stay free of runtime imports.
 */
import type { AsPlainObject, Options, SearchOptions } from 'minisearch';

export const DOCS_INDEX_SCHEMA_VERSION = 1;
export const DOCS_INDEX_PUBLIC_PATH = '/assistant/docs-index.json';
export const DOCS_INDEX_META_PUBLIC_PATH = '/assistant/docs-index.meta.json';
export const DOCS_BASE_URL = 'https://rucio.cern.ch/documentation';
export const REST_API_DOC_URL = 'https://rucio.cern.ch/documentation/html/rest_api_doc.html';

export interface DocsChunk {
    id: number;
    title: string; // "Page title > Heading" or "GET /rules/{rule_id}"
    text: string; // plain text used for indexing
    excerpt: string; // stored, at most DOCS_EXCERPT_MAX chars
    url: string;
    source: 'docs' | 'openapi';
}

export type StoredDocsChunk = Pick<DocsChunk, 'title' | 'excerpt' | 'url' | 'source'>;

export interface DocsIndexMetadata {
    docsVersion: string; // rucio/documentation commit sha
    docsCommitDate: string; // ISO
    openapiVersion: string; // OpenAPI info.version, e.g. 41.0.0rc1
    openapiSha256: string;
    builtAt: string; // ISO
    chunkCount: number;
    minisearchVersion: string;
}

/** Contents of public/assistant/docs-index.meta.json, read by the settings page without loading the index. */
export interface DocsIndexMetaFile {
    schemaVersion: typeof DOCS_INDEX_SCHEMA_VERSION;
    metadata: DocsIndexMetadata;
}

export interface DocsIndexFile {
    schemaVersion: typeof DOCS_INDEX_SCHEMA_VERSION;
    metadata: DocsIndexMetadata;
    index: AsPlainObject;
}

export const DOCS_EXCERPT_MAX = 900;

const STOPWORDS = new Set(
    [
        'a an and are as at be by can do does for from how i if in is it me my of on or',
        'should that the this to what when where which why with you your',
    ]
        .join(' ')
        .split(' '),
);

/** Lowercases and drops stopwords. Used for indexing and for queries. */
export function processDocsTerm(term: string): string | null {
    const lower = term.toLowerCase();
    return STOPWORDS.has(lower) ? null : lower;
}

export const DOCS_INDEX_OPTIONS: Options<DocsChunk> = {
    fields: ['title', 'text'],
    storeFields: ['title', 'excerpt', 'url', 'source'],
    processTerm: processDocsTerm,
};

export const DOCS_SEARCH_OPTIONS: SearchOptions = {
    boost: { title: 2 },
    fuzzy: 0.2,
    prefix: true,
    combineWith: 'OR',
};
