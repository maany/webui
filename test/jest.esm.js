/**
 * Lets Jest load ESM-only dependencies. Used by every test/<project>/jest.<project>.config.js.
 *
 * next/jest compiles node_modules with SWC only for packages on the allow list inside its
 * transformIgnorePatterns, and a custom config can append patterns but not edit that list.
 * withEsmPackages adds ESM_PACKAGES to the allow list and installs test/jest.resolver.js for
 * packages whose package.json only exports the "import" condition (for example @tanstack/ai).
 *
 * Entries are regular expression fragments matched against the path after node_modules/.
 * idb, minisearch and @duckdb/duckdb-wasm ship CommonJS builds and need no entry. Under jsdom,
 * @duckdb/duckdb-wasm resolves to its browser build, which needs Worker: mock it with jest.mock
 * or run that test file with the `@jest-environment node` docblock.
 */
const ESM_PACKAGES = [
    'permix',
    // TanStack AI
    '@tanstack/ai[^/]*',
    '@tanstack/openai-base',
    // react-markdown, remark-gfm, rehype-sanitize and their unified dependencies
    'react-markdown',
    'remark-[^/]+',
    'rehype-[^/]+',
    'unified',
    'bail',
    'ccount',
    'character-entities[^/]*',
    'character-reference-invalid',
    'comma-separated-tokens',
    'decode-named-character-reference',
    'devlop',
    'escape-string-regexp',
    'estree-util-[^/]+',
    'hast-util-[^/]+',
    'html-url-attributes',
    'is-alphabetical',
    'is-alphanumerical',
    'is-decimal',
    'is-hexadecimal',
    'is-plain-obj',
    'longest-streak',
    'markdown-table',
    'mdast-util-[^/]+',
    'micromark[^/]*',
    'parse-entities',
    'property-information',
    'space-separated-tokens',
    'stringify-entities',
    'trim-lines',
    'trough',
    'unist-util-[^/]+',
    'vfile[^/]*',
    'zwitch',
    '@ungap/structured-clone',
];

function withEsmPackages(createConfig) {
    return async () => {
        const config = await createConfig();
        const allow = ESM_PACKAGES.join('|');
        config.transformIgnorePatterns = config.transformIgnorePatterns.map(pattern =>
            pattern.includes('node_modules') && pattern.includes('(?!(') ? pattern.replace('(?!(', `(?!(${allow}|`) : pattern,
        );
        config.resolver = require.resolve('./jest.resolver.js');
        return config;
    };
}

module.exports = { ESM_PACKAGES, withEsmPackages };
