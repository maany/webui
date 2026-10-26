/**
 * Builds public/assistant/docs-index.json from the pinned sources in tools/assistant/docs-sources.json.
 *
 *   npm run assistant:build-docs-index                       # download pinned sources
 *   npm run assistant:build-docs-index -- --docs-dir ../documentation --openapi-file ./rest_api_doc.html
 *   npm run assistant:build-docs-index -- --update-pins      # accept a republished OpenAPI spec
 *
 * Runs with Node >= 22.18 type stripping (no tsx or ts-node needed). The npm script passes
 * --disable-warning=MODULE_TYPELESS_PACKAGE_JSON because the shared src modules live in a package without "type".
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    buildDocsIndex,
    canonicalJson,
    chunkMarkdown,
    extractRedocDefinition,
    normaliseOpenApi,
    openapiChunks,
    type ChunkDraft,
    type OpenApiSpec,
} from './docs-index-lib.ts';
import type { DocsIndexMetaFile } from '../../src/lib/infrastructure/assistant/docs-index-format.ts';

interface DocsSources {
    documentation: { repo: string; ref: string; commitDate: string };
    openapi: { url: string; version: string; sha256: string };
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const sourcesPath = join(here, 'docs-sources.json');

function argValue(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    if (i < 0) return undefined;
    const value = process.argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    return value;
}

function validateSources(sources: DocsSources): void {
    if (!/^[\w.-]+\/[\w.-]+$/.test(sources.documentation?.repo ?? '')) {
        throw new Error(`docs-sources.json: documentation.repo must look like "owner/name", got "${sources.documentation?.repo}"`);
    }
    if (!/^[0-9a-f]{40}$/.test(sources.documentation?.ref ?? '')) {
        throw new Error(`docs-sources.json: documentation.ref must be a 40 character commit sha, got "${sources.documentation?.ref}"`);
    }
}

function listMarkdown(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...listMarkdown(full));
        else if (/\.mdx?$/.test(entry)) out.push(full);
    }
    return out.sort();
}

async function fetchOk(url: string): Promise<Response> {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`GET ${url} failed with ${res.status}`);
    return res;
}

async function docsRoot(sources: DocsSources): Promise<{ root: string; cleanup: () => void }> {
    const local = argValue('--docs-dir');
    if (local) {
        const head = execFileSync('git', ['-C', local, 'rev-parse', 'HEAD']).toString().trim();
        if (head !== sources.documentation.ref) {
            throw new Error(`--docs-dir is at ${head}, but docs-sources.json pins ${sources.documentation.ref}. Check out the pinned ref first.`);
        }
        const dirty = execFileSync('git', ['-C', local, 'status', '--porcelain']).toString().trim();
        if (dirty !== '') throw new Error(`--docs-dir ${local} has uncommitted changes; use a clean checkout of the pinned ref.`);
        if (!existsSync(join(local, 'docs')) || !statSync(join(local, 'docs')).isDirectory()) {
            throw new Error(`--docs-dir ${local} has no docs directory.`);
        }
        return { root: resolve(local), cleanup: () => undefined };
    }
    const tmp = mkdtempSync(join(tmpdir(), 'rucio-docs-'));
    try {
        const url = `https://codeload.github.com/${sources.documentation.repo}/tar.gz/${sources.documentation.ref}`;
        const tarball = join(tmp, 'docs.tar.gz');
        writeFileSync(tarball, Buffer.from(await (await fetchOk(url)).arrayBuffer()));
        execFileSync('tar', ['-xzf', tarball, '-C', tmp]);
        const extracted = readdirSync(tmp).find(name => name !== 'docs.tar.gz');
        if (!extracted) throw new Error('Documentation tarball was empty');
        return { root: join(tmp, extracted), cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
    } catch (error) {
        rmSync(tmp, { recursive: true, force: true });
        throw error;
    }
}

async function loadOpenApi(sources: DocsSources): Promise<OpenApiSpec> {
    const file = argValue('--openapi-file');
    const text = file ? readFileSync(file, 'utf8') : await (await fetchOk(sources.openapi.url)).text();
    return text.trimStart().startsWith('{') ? normaliseOpenApi(JSON.parse(text)) : extractRedocDefinition(text);
}

async function main(): Promise<void> {
    const sources = JSON.parse(readFileSync(sourcesPath, 'utf8')) as DocsSources;
    validateSources(sources);
    const updatePins = process.argv.includes('--update-pins');
    const out = resolve(repoRoot, argValue('--out') ?? 'public/assistant/docs-index.json');

    let newPin: DocsSources['openapi'] | undefined;
    const spec = await loadOpenApi(sources);
    const sha256 = createHash('sha256').update(canonicalJson(spec)).digest('hex');
    const version = spec.info?.version ?? 'unknown';
    if (sha256 !== sources.openapi.sha256 || version !== sources.openapi.version) {
        if (!updatePins) {
            throw new Error(
                `OpenAPI spec changed (version ${version}, sha256 ${sha256}); pinned ${sources.openapi.version} ${sources.openapi.sha256}. ` +
                    'Re-run with --update-pins to accept it.',
            );
        }
        newPin = { ...sources.openapi, version, sha256 };
    }

    const { root, cleanup } = await docsRoot(sources);
    try {
        const docsDir = join(root, 'docs');
        const drafts: ChunkDraft[] = [];
        const files = listMarkdown(docsDir);
        for (const file of files) {
            drafts.push(...chunkMarkdown(relative(docsDir, file), readFileSync(file, 'utf8')));
        }
        drafts.push(...openapiChunks(spec));

        const minisearchVersion = (JSON.parse(readFileSync(join(repoRoot, 'node_modules/minisearch/package.json'), 'utf8')) as { version: string })
            .version;
        const index = buildDocsIndex(drafts, {
            docsVersion: sources.documentation.ref,
            docsCommitDate: sources.documentation.commitDate,
            openapiVersion: version,
            openapiSha256: sha256,
            builtAt: new Date().toISOString(),
            minisearchVersion,
        });
        const json = JSON.stringify(index);
        const metaOut = out.replace(/\.json$/, '.meta.json');
        const meta: DocsIndexMetaFile = { schemaVersion: index.schemaVersion, metadata: index.metadata };
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, json);
        writeFileSync(metaOut, `${JSON.stringify(meta, null, 4)}\n`);
        console.log(`Wrote ${relative(repoRoot, out)}: ${files.length} pages, ${index.metadata.chunkCount} chunks, ${json.length} bytes`);
        console.log(`Wrote ${relative(repoRoot, metaOut)}`);
        if (newPin) {
            writeFileSync(sourcesPath, `${JSON.stringify({ ...sources, openapi: newPin }, null, 4)}\n`);
            console.log(`Updated OpenAPI pin to ${newPin.version} ${newPin.sha256}`);
        }
    } finally {
        cleanup();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
