import { readFileSync } from 'fs';
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
];

const FORBIDDEN = [/@tanstack\/ai/, /duckdb/i, /component-library\/features\/assistant/, /assistant\/tools\//, /tanstack-agent-runner/];

describe('page-side assistant modules', () => {
    it.each(PAGE_SIDE_MODULES)('%s imports no assistant runtime code', file => {
        const source = readFileSync(path.join(process.cwd(), file), 'utf8');
        const imports = source.split('\n').filter(line => /^\s*(import|export)\b.*from\s+['"]/.test(line));
        FORBIDDEN.forEach(pattern => imports.forEach(line => expect(line).not.toMatch(pattern)));
    });
});
