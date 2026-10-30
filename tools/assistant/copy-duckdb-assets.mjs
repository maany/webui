#!/usr/bin/env node
// Copies the DuckDB-wasm bundles Rucio bot uses into public/duckdb so they are served from the WebUI's own
// origin (no CDN, works air-gapped). Runs before `next dev` and `next build`; the output is gitignored.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS = ['duckdb-mvp.wasm', 'duckdb-eh.wasm', 'duckdb-browser-mvp.worker.js', 'duckdb-browser-eh.worker.js'];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
// package.json is not in the package's export map, so resolve an exported file and walk up.
const distDir = path.dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm'));
const version = JSON.parse(readFileSync(path.join(distDir, '..', 'package.json'), 'utf8')).version;
const outDir = path.join(root, 'public', 'duckdb');
const stamp = path.join(outDir, 'VERSION');

const upToDate = existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === version && ASSETS.every(file => existsSync(path.join(outDir, file)));

if (upToDate) {
    console.log(`[duckdb-assets] public/duckdb is up to date (${version})`);
} else {
    mkdirSync(outDir, { recursive: true });
    for (const file of ASSETS) copyFileSync(path.join(distDir, file), path.join(outDir, file));
    writeFileSync(stamp, `${version}\n`);
    console.log(`[duckdb-assets] copied ${ASSETS.length} files of @duckdb/duckdb-wasm ${version} to public/duckdb`);
}
