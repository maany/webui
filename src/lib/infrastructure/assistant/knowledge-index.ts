import MiniSearch from 'minisearch';
import type { AssistantKnowledgeIndexPort, DocHit } from '@/lib/core/port/secondary/assistant-knowledge-index-port';
import {
    DOCS_INDEX_META_PUBLIC_PATH,
    DOCS_INDEX_OPTIONS,
    DOCS_INDEX_PUBLIC_PATH,
    DOCS_INDEX_SCHEMA_VERSION,
    DOCS_SEARCH_OPTIONS,
    type DocsChunk,
    type DocsIndexFile,
    type DocsIndexMetaFile,
    type DocsIndexMetadata,
    type StoredDocsChunk,
} from '@/lib/infrastructure/assistant/docs-index-format';

export const SNIPPET_MAX = 500;
export const MAX_DOC_HITS = 8;

export interface KnowledgeIndexLoaders {
    loadIndex(): Promise<DocsIndexFile>;
    loadMeta(): Promise<DocsIndexMetaFile>;
}

async function fetchJson<T>(path: string): Promise<T> {
    const res = await fetch(path, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
    return (await res.json()) as T;
}

export const fetchKnowledgeIndexLoaders: KnowledgeIndexLoaders = {
    loadIndex: () => fetchJson<DocsIndexFile>(DOCS_INDEX_PUBLIC_PATH),
    loadMeta: () => fetchJson<DocsIndexMetaFile>(DOCS_INDEX_META_PUBLIC_PATH),
};

/** Up to SNIPPET_MAX characters of the excerpt, centred on the first query term found in it. */
export function makeSnippet(excerpt: string, query: string): string {
    if (excerpt.length <= SNIPPET_MAX) return excerpt;
    const lower = excerpt.toLowerCase();
    const terms = query
        .toLowerCase()
        .split(/\W+/)
        .filter(t => t.length > 2);
    const hit = terms.map(t => lower.indexOf(t)).filter(i => i >= 0);
    const centre = hit.length > 0 ? Math.min(...hit) : 0;
    const start = Math.max(0, Math.min(centre - SNIPPET_MAX / 4, excerpt.length - SNIPPET_MAX));
    const slice = excerpt.slice(start, start + SNIPPET_MAX).trim();
    return `${start > 0 ? '...' : ''}${slice}${start + SNIPPET_MAX < excerpt.length ? '...' : ''}`;
}

function toPortMetadata(metadata: DocsIndexMetadata): { docsVersion: string; openapiVersion: string; builtAt: string } {
    return { docsVersion: metadata.docsVersion, openapiVersion: metadata.openapiVersion, builtAt: metadata.builtAt };
}

/**
 * Browser adapter over the static MiniSearch index in public/assistant. The index is fetched on the first
 * search and kept in memory; a failed load is retried on the next call.
 */
export function createKnowledgeIndex(loaders: KnowledgeIndexLoaders = fetchKnowledgeIndexLoaders): AssistantKnowledgeIndexPort & {
    fullMetadata(): Promise<DocsIndexMetadata | undefined>;
} {
    let loaded: Promise<{ search: MiniSearch<DocsChunk>; metadata: DocsIndexMetadata }> | undefined;

    function load() {
        if (!loaded) {
            loaded = loaders
                .loadIndex()
                .then(file => {
                    if (file.schemaVersion !== DOCS_INDEX_SCHEMA_VERSION) {
                        throw new Error(`Unsupported docs index schema ${String(file.schemaVersion)}`);
                    }
                    return { search: MiniSearch.loadJS<DocsChunk>(file.index, DOCS_INDEX_OPTIONS), metadata: file.metadata };
                })
                .catch((error: unknown) => {
                    loaded = undefined;
                    throw error;
                });
        }
        return loaded;
    }

    async function fullMetadata(): Promise<DocsIndexMetadata | undefined> {
        try {
            if (loaded) return (await loaded).metadata;
            const meta = await loaders.loadMeta();
            return meta.schemaVersion === DOCS_INDEX_SCHEMA_VERSION ? meta.metadata : undefined;
        } catch {
            return undefined;
        }
    }

    return {
        async search(query: string, limit: number): Promise<DocHit[]> {
            const trimmed = query.trim();
            if (trimmed === '') return [];
            const { search } = await load();
            const max = Math.max(1, Math.min(MAX_DOC_HITS, Math.floor(Number.isFinite(limit) ? limit : 5)));
            return search
                .search(trimmed, DOCS_SEARCH_OPTIONS)
                .slice(0, max)
                .map(result => {
                    const stored = result as unknown as StoredDocsChunk;
                    return {
                        title: stored.title,
                        snippet: makeSnippet(stored.excerpt, trimmed),
                        url: stored.url,
                        source: stored.source,
                        score: Math.round(result.score * 100) / 100,
                    };
                });
        },
        async metadata() {
            const metadata = await fullMetadata();
            return metadata ? toPortMetadata(metadata) : undefined;
        },
        fullMetadata,
    };
}

/** Shared instance used by the search_docs tool and the settings page. */
export const knowledgeIndex = createKnowledgeIndex();
