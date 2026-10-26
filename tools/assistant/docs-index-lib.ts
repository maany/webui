/**
 * Pure helpers for build-docs-index.ts. No filesystem or network access here so they can be unit tested.
 */
import MiniSearch from 'minisearch';
import {
    DOCS_BASE_URL,
    DOCS_EXCERPT_MAX,
    DOCS_INDEX_OPTIONS,
    DOCS_INDEX_SCHEMA_VERSION,
    REST_API_DOC_URL,
    type DocsChunk,
    type DocsIndexFile,
    type DocsIndexMetadata,
} from '../../src/lib/infrastructure/assistant/docs-index-format.ts';
import { frontmatterString, parseFrontmatterBlock, splitFrontmatter } from '../../src/lib/infrastructure/assistant/skills/skill-md.ts';

export type ChunkDraft = Omit<DocsChunk, 'id'>;

/** Section longer than this is split into parts at paragraph boundaries. */
export const MAX_CHUNK_CHARS = 4000;

const NUMBER_PREFIX_RE = /^\d+\s*[-_.]+\s*(?=\D)/;

/** Docusaurus route for a docs file, relative to the docs root, without leading or trailing slash. */
export function docRoute(relPath: string, frontmatter: Record<string, unknown>): string {
    const segments = relPath.replace(/\\/g, '/').split('/');
    const file = segments.pop() ?? '';
    const dirs = segments.map(s => s.replace(NUMBER_PREFIX_RE, ''));
    const slug = typeof frontmatter.slug === 'string' ? frontmatter.slug.trim() : undefined;
    if (slug !== undefined) {
        const joined = slug.startsWith('/') ? slug : [...dirs, slug].join('/');
        return joined.replace(/^\/+|\/+$/g, '');
    }
    const base = file.replace(/\.mdx?$/, '').replace(NUMBER_PREFIX_RE, '');
    // Docusaurus category index convention: index.md, README.md or <dir>/<dir>.md render at the directory URL.
    const parent = dirs[dirs.length - 1];
    if (/^(index|readme)$/i.test(base) || (parent !== undefined && base.toLowerCase() === parent.toLowerCase())) {
        return dirs.join('/');
    }
    const id = typeof frontmatter.id === 'string' && frontmatter.id.trim() !== '' ? frontmatter.id.trim() : base;
    return [...dirs, id].filter(s => s !== '').join('/');
}

export function pageUrl(route: string): string {
    return route === '' ? `${DOCS_BASE_URL}/` : `${DOCS_BASE_URL}/${route}/`;
}

/** Strip inline markdown so a heading reads as plain text. */
export function inlineText(markdown: string): string {
    return markdown
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/[*_`~]/g, '')
        .replace(/\\(.)/g, '$1')
        .trim();
}

/** github-slugger compatible anchor, as Docusaurus generates for headings. */
export function headingAnchor(heading: string, used: Map<string, number>): { text: string; anchor: string } {
    const custom = /\s*\{#([^}]+)\}\s*$/.exec(heading);
    const raw = custom ? heading.slice(0, custom.index) : heading;
    const text = inlineText(raw);
    let anchor =
        custom?.[1] ??
        raw
            .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/<[^>]+>/g, '')
            .replace(/&[a-z]+;|&#\d+;/gi, '')
            .replace(/[*`~]/g, '')
            .trim()
            .toLowerCase()
            .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
            .replace(/ /g, '-');
    if (!custom) {
        const seen = used.get(anchor);
        used.set(anchor, (seen ?? -1) + 1);
        if (seen !== undefined) anchor = `${anchor}-${seen + 1}`;
    }
    return { text, anchor };
}

/** Markdown or MDX to plain text for indexing: keeps code content, drops markup, MDX imports and JSX tags. */
export function toPlainText(markdown: string): string {
    return markdown
        .split('\n')
        .filter(line => !/^\s*(import|export)\s.+$/.test(line))
        .filter(line => !/^\s*(```|~~~|:::)/.test(line))
        .join('\n')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/<\/?[A-Za-z][^>]*>/g, ' ')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/[*_`]/g, '')
        .replace(/\|/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function excerptOf(text: string): string {
    if (text.length <= DOCS_EXCERPT_MAX) return text;
    const cut = text.slice(0, DOCS_EXCERPT_MAX);
    const lastSpace = cut.lastIndexOf(' ');
    return `${cut.slice(0, lastSpace > 0 ? lastSpace : DOCS_EXCERPT_MAX)}...`;
}

interface Section {
    heading?: string;
    lines: string[];
}

function splitSections(body: string): Section[] {
    const sections: Section[] = [{ lines: [] }];
    let fence: string | null = null;
    for (const line of body.split(/\r?\n/)) {
        const fenceMatch = /^\s*(```|~~~)/.exec(line);
        if (fenceMatch) {
            fence = fence === null ? fenceMatch[1] : fence === fenceMatch[1] ? null : fence;
        }
        const heading = fence === null ? /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line) : null;
        if (heading) {
            sections.push({ heading: heading[2], lines: [] });
        } else {
            sections[sections.length - 1].lines.push(line);
        }
    }
    return sections;
}

function splitLong(text: string): string[] {
    if (text.length <= MAX_CHUNK_CHARS) return [text];
    const parts: string[] = [];
    let current = '';
    for (const paragraph of text.split(/\n\n+/)) {
        if (current !== '' && current.length + paragraph.length + 2 > MAX_CHUNK_CHARS) {
            parts.push(current);
            current = '';
        }
        current = current === '' ? paragraph : `${current}\n\n${paragraph}`;
    }
    if (current !== '') parts.push(current);
    return parts.flatMap(p => (p.length > MAX_CHUNK_CHARS * 2 ? [p.slice(0, MAX_CHUNK_CHARS * 2)] : [p]));
}

/** Chunks one docs page by h2/h3 headings (ignoring headings inside code fences). */
export function chunkMarkdown(relPath: string, raw: string): ChunkDraft[] {
    const split = splitFrontmatter(raw);
    const frontmatter = split ? parseFrontmatterBlock(split.frontmatter) : {};
    const body = (split ? split.body : raw).replace(/<!--[\s\S]*?-->/g, '');
    const route = docRoute(relPath, frontmatter);
    const url = pageUrl(route);
    const h1 = /^#\s+(.+)$/m.exec(body);
    const pageTitle =
        frontmatterString(frontmatter, 'title') ?? (h1 ? inlineText(h1[1]) : undefined) ?? relPath.replace(/^.*\//, '').replace(/\.mdx?$/, '');
    const used = new Map<string, number>();
    const drafts: ChunkDraft[] = [];
    for (const section of splitSections(body)) {
        const text = toPlainText(section.lines.join('\n'));
        let title = pageTitle;
        let sectionUrl = url;
        if (section.heading !== undefined) {
            const { text: headingText, anchor } = headingAnchor(section.heading, used);
            title = `${pageTitle} > ${headingText}`;
            sectionUrl = `${url}#${anchor}`;
        }
        if (text === '' && section.heading === undefined) continue;
        const parts = splitLong(text);
        parts.forEach((part, index) => {
            drafts.push({
                title: parts.length > 1 ? `${title} (part ${index + 1})` : title,
                text: part,
                excerpt: excerptOf(part),
                url: sectionUrl,
                source: 'docs',
            });
        });
    }
    return drafts;
}

interface OpenApiParameter {
    name?: string;
    in?: string;
    description?: string;
}
interface OpenApiOperation {
    summary?: string;
    description?: string;
    tags?: string[];
    parameters?: OpenApiParameter[];
}
export interface OpenApiSpec {
    openapi?: string;
    info?: { version?: string; title?: string };
    paths?: Record<string, Record<string, unknown>>;
}

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'head', 'options']);

/** One chunk per OpenAPI operation. Links point at the REST API page (Redoc v3 has no stable per-operation anchor). */
export function openapiChunks(spec: OpenApiSpec): ChunkDraft[] {
    const drafts: ChunkDraft[] = [];
    for (const [path, operations] of Object.entries(spec.paths ?? {})) {
        for (const [method, value] of Object.entries(operations)) {
            if (!HTTP_METHODS.has(method) || typeof value !== 'object' || value === null) continue;
            const op = value as OpenApiOperation;
            const params = (op.parameters ?? [])
                .filter(p => p.name)
                .map(p => `${p.name} (${p.in ?? 'param'}): ${p.description ?? ''}`.trim())
                .join('\n');
            const text = [op.tags?.length ? `Tags: ${op.tags.join(', ')}` : '', op.summary ?? '', op.description ?? '', params]
                .filter(s => s !== '')
                .join('\n');
            drafts.push({
                title: `${method.toUpperCase()} ${path}${op.summary ? ` (${op.summary})` : ''}`,
                text,
                excerpt: excerptOf(text),
                url: REST_API_DOC_URL,
                source: 'openapi',
            });
        }
    }
    return drafts;
}

/** Reads one JSON value starting at `start` (an opening brace), honouring strings and escapes. */
export function readJsonObjectAt(text: string, start: number): string {
    if (text[start] !== '{') throw new Error(`Expected "{" at ${start}`);
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (ch === '\\') i++;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    throw new Error('Unterminated JSON object');
}

const OPENAPI_TOP_LEVEL = ['openapi', 'info', 'servers', 'paths', 'components', 'security', 'tags'];

function stripCodeSamples(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stripCodeSamples);
    if (typeof value === 'object' && value !== null) {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
            if (k !== 'x-codeSamples') out[k] = stripCodeSamples(v);
        }
        return out;
    }
    return value;
}

/** Keeps only standard top-level OpenAPI keys and drops x-codeSamples. */
export function normaliseOpenApi(raw: Record<string, unknown>): OpenApiSpec {
    const out: Record<string, unknown> = {};
    for (const key of OPENAPI_TOP_LEVEL) {
        if (key in raw) out[key] = stripCodeSamples(raw[key]);
    }
    if (typeof out.openapi !== 'string' || typeof out.paths !== 'object') {
        throw new Error('Not an OpenAPI 3 document');
    }
    return out as OpenApiSpec;
}

/** Extracts the spec Redoc embeds in rest_api_doc.html as `__redoc_definition = {...}`. */
export function extractRedocDefinition(html: string): OpenApiSpec {
    const marker = /__redoc_definition\s*=\s*/.exec(html);
    if (!marker) throw new Error('__redoc_definition not found in the REST API page');
    const json = readJsonObjectAt(html, marker.index + marker[0].length);
    return normaliseOpenApi(JSON.parse(json) as Record<string, unknown>);
}

/** JSON with sorted keys, so the hash does not depend on key order. */
export function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (typeof value === 'object' && value !== null) {
        const entries = Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

export function buildDocsIndex(drafts: ChunkDraft[], metadata: Omit<DocsIndexMetadata, 'chunkCount'>): DocsIndexFile {
    const chunks: DocsChunk[] = drafts.map((d, id) => ({ id, ...d }));
    const search = new MiniSearch<DocsChunk>(DOCS_INDEX_OPTIONS);
    search.addAll(chunks);
    return {
        schemaVersion: DOCS_INDEX_SCHEMA_VERSION,
        metadata: { ...metadata, chunkCount: chunks.length },
        index: search.toJSON(),
    };
}
