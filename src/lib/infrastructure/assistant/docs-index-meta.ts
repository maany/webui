import {
    DOCS_INDEX_META_PUBLIC_PATH,
    DOCS_INDEX_SCHEMA_VERSION,
    type DocsIndexMetadata,
    type DocsIndexMetaFile,
} from '@/lib/infrastructure/assistant/docs-index-format';

/** Fetches one JSON file from the app's own origin. Shared with the knowledge index loaders. */
export async function fetchJson<T>(path: string): Promise<T> {
    const res = await fetch(path, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
    return (await res.json()) as T;
}

/**
 * Reads the small docs-index.meta.json without loading the search library or the index.
 * Returns undefined when it cannot be read or has an unknown schema; never throws.
 */
export async function loadDocsIndexMetadata(): Promise<DocsIndexMetadata | undefined> {
    try {
        const meta = await fetchJson<DocsIndexMetaFile>(DOCS_INDEX_META_PUBLIC_PATH);
        return meta.schemaVersion === DOCS_INDEX_SCHEMA_VERSION ? meta.metadata : undefined;
    } catch {
        return undefined;
    }
}
