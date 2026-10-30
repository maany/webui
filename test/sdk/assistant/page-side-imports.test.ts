import { existsSync, readFileSync, statSync } from 'fs';
import path from 'path';

/** Modules that pages import. They must not pull assistant runtime code into page bundles. */
const PAGE_SIDE_MODULES = [
    'src/lib/infrastructure/hooks/usePageAction.tsx',
    'src/lib/infrastructure/hooks/usePageDescribe.tsx',
    'src/lib/infrastructure/assistant/page-action-bridge.ts',
    'src/lib/infrastructure/assistant/page-summary-text.ts',
    'src/lib/infrastructure/assistant/page-context.ts',
    'src/lib/infrastructure/assistant/page-tool-errors.ts',
    'src/lib/infrastructure/assistant/tool-error.ts',
    'src/lib/infrastructure/assistant/tool-types.ts',
    'src/lib/infrastructure/assistant/page-url-params.ts',
    'src/lib/infrastructure/assistant/page-summaries.ts',
    'src/lib/infrastructure/assistant/in-app-href.ts',
    'src/lib/infrastructure/assistant/page-actions/fetch-ndjson.ts',
    'src/lib/infrastructure/assistant/page-actions/rule-create-prefill.ts',
    'src/lib/infrastructure/assistant/page-actions/list-actions.ts',
    'src/component-library/pages/DID/details/DetailsDID.tsx',
    'src/component-library/pages/Rule/details/DetailsRule.tsx',
    'src/component-library/pages/RSE/details/DetailsRSE.tsx',
    'src/app/(rucio)/account/[name]/DetailsAccountClient.tsx',
    'src/component-library/pages/Subscriptions/details/DetailsSubscription.tsx',
    'src/app/(rucio)/dids/ListDIDClient.tsx',
    'src/app/(rucio)/rules/ListRuleClient.tsx',
    'src/app/(rucio)/rses/ListRSEClient.tsx',
    'src/app/(rucio)/subscriptions/ListSubscriptionClient.tsx',
    'src/app/(rucio)/rule/create/page.tsx',
    'src/component-library/pages/Rule/create/CreateRule.tsx',
];

const FORBIDDEN = [/@tanstack\/ai/, /duckdb/i, /component-library\/features\/assistant/, /assistant\/tools\//, /tanstack-agent-runner/];

/** Files followed transitively: the assistant page-side chain. Everything else is checked only as an entry's specifier. */
const FOLLOWED = [
    /^src\/lib\/infrastructure\/assistant\//,
    /^src\/lib\/infrastructure\/hooks\/usePage[^/]*$/,
    /^src\/lib\/infrastructure\/utils\/navigation\.ts$/,
    /^src\/component-library\/pages\/Rule\/create\/create-rule-validation\.ts$/,
];

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

/** Every module specifier in a whole source: static, multiline, re-export, side-effect, dynamic and require. */
function extractSpecifiers(source: string): string[] {
    return Array.from(source.matchAll(SPECIFIER), match => match[1]);
}

const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx', '.d.ts'];

function resolveSpecifier(specifier: string, fromFile: string): string | null {
    let base: string;
    if (specifier.startsWith('@/')) base = path.join('src', specifier.slice(2));
    else if (specifier.startsWith('.')) base = path.join(path.dirname(fromFile), specifier);
    else return null;
    for (const extension of EXTENSIONS) {
        const candidate = base + extension;
        const absolute = path.join(process.cwd(), candidate);
        if (existsSync(absolute) && !absolute.endsWith('/') && /\.[a-z]+$/.test(candidate) && statIsFile(absolute)) return candidate;
    }
    return null;
}

function statIsFile(absolute: string): boolean {
    try {
        return statSync(absolute).isFile();
    } catch {
        return false;
    }
}

function collectVisited(entries: string[]): Map<string, string[]> {
    const visited = new Map<string, string[]>();
    const queue = [...entries];
    while (queue.length > 0) {
        const file = queue.shift() as string;
        if (visited.has(file)) continue;
        const specifiers = extractSpecifiers(readFileSync(path.join(process.cwd(), file), 'utf8'));
        visited.set(file, specifiers);
        for (const specifier of specifiers) {
            const resolved = resolveSpecifier(specifier, file);
            if (resolved && FOLLOWED.some(pattern => pattern.test(resolved))) queue.push(resolved);
        }
    }
    return visited;
}

const visited = collectVisited(PAGE_SIDE_MODULES);

describe('import extractor self-test', () => {
    const fixture = [
        "import {\n  x,\n} from '@/component-library/features/assistant/AssistantProvider';",
        "import '@tanstack/ai';",
        "const lazy = () => import('@/lib/infrastructure/assistant/tools/read-tools');",
        "export { y } from './tanstack-agent-runner';",
        "const z = require('duckdb');",
    ].join('\n');

    it('catches multiline, side-effect, dynamic, re-export and require specifiers', () => {
        expect(extractSpecifiers(fixture)).toEqual([
            '@/component-library/features/assistant/AssistantProvider',
            '@tanstack/ai',
            '@/lib/infrastructure/assistant/tools/read-tools',
            './tanstack-agent-runner',
            'duckdb',
        ]);
    });

    it('flags every forbidden specifier in the fixture', () => {
        const flagged = extractSpecifiers(fixture).filter(specifier => FORBIDDEN.some(pattern => pattern.test(specifier)));
        expect(flagged).toHaveLength(5);
    });
});

describe('page-side assistant modules', () => {
    it('visits the entry files and the followed chain', () => {
        PAGE_SIDE_MODULES.forEach(file => expect(visited.has(file)).toBe(true));
        expect(visited.size).toBeGreaterThanOrEqual(PAGE_SIDE_MODULES.length);
    });

    it.each(Array.from(visited.entries()))('%s imports no assistant runtime code', (_file, specifiers) => {
        FORBIDDEN.forEach(pattern => specifiers.forEach(specifier => expect(specifier).not.toMatch(pattern)));
    });
});
