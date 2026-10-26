import fs from 'fs';
import path from 'path';
import { Role } from '@/lib/core/entity/auth-models';
import type { ToolSpec } from '@/lib/core/entity/assistant/tool';
import { API_SCHEMAS, type RouteName } from '@/lib/infrastructure/api-schemas';
import { CONTROLLER_FLAG_MAP } from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import { allTools } from '@/lib/infrastructure/assistant/tool-registry';
import { convertSchemaToJsonSchema } from '@tanstack/ai';
import { ASSISTANT_DATA_TOOLS_PROMPT, READ_TOOL_SPECS } from '@/lib/infrastructure/assistant/tools';

const FEATURE_DIR = path.join(process.cwd(), 'src/app/api/feature');
/** Route directories that are not tools: the stream template and assistant infrastructure. mock-* routes are skipped by prefix. */
const NOT_TOOLS = new Set(['template-stream', 'get-assistant-config']);
/** Read-only routes that use POST. Every other non-GET route is a write. */
const READ_OVER_POST = new Set(['list-account-rse-quotas']);
/** Read routes whose tool lands in a later phase. Phase 7 removes 'list-requests' when it registers list_requests. */
const PENDING_READ_ROUTES = new Set(['list-requests']);
const EM_DASH = String.fromCharCode(0x2014);

const routeSource = (route: string): string => fs.readFileSync(path.join(FEATURE_DIR, route, 'route.ts'), 'utf8');
const ROUTES = fs
    .readdirSync(FEATURE_DIR)
    .filter(dir => !dir.startsWith('mock-') && !NOT_TOOLS.has(dir) && fs.existsSync(path.join(FEATURE_DIR, dir, 'route.ts')))
    .sort();
const methodsOf = (route: string): string[] =>
    Array.from(routeSource(route).matchAll(/export\s+(?:const|async\s+function|function)\s+(GET|POST|PUT|DELETE)\b/g), match => match[1]);
const READ_ROUTES = ROUTES.filter(route => methodsOf(route).includes('GET') || READ_OVER_POST.has(route));
const WRITE_ROUTES = ROUTES.filter(route => !READ_ROUTES.includes(route));
/** Streaming routes call executeAuthenticatedController(controller, params, true). */
const isStreaming = (route: string): boolean => /,\s*true\s*,?\s*(?:\/\/[^\n]*\s*)?\)/.test(routeSource(route));
const featureSpecs = (): ToolSpec<unknown>[] =>
    allTools()
        .map(tool => tool.spec)
        .filter(spec => spec.executor === 'feature');
const specsFor = (route: string): ToolSpec<unknown>[] => featureSpecs().filter(spec => spec.route?.path === `/api/feature/${route}`);
const flagsOfRoute = (route: string): string[] => {
    const key = /CONTROLLERS\.([A-Z_]+)/.exec(routeSource(route))?.[1];
    const symbol = key ? (CONTROLLERS as Record<string, symbol>)[key] : undefined;
    return symbol ? [...((CONTROLLER_FLAG_MAP.get(symbol) ?? []) as string[])] : [];
};

describe('read tool registry', () => {
    it('finds the route directories', () => {
        expect(READ_ROUTES.length).toBeGreaterThan(0);
        expect(WRITE_ROUTES.length).toBeGreaterThan(0);
        expect(READ_ROUTES).toContain('list-account-rse-quotas');
    });

    it.each(READ_ROUTES)('%s has exactly one read tool named after the route', route => {
        const specs = specsFor(route);
        if (PENDING_READ_ROUTES.has(route) && specs.length === 0) return;
        expect(specs).toHaveLength(1);
        const [spec] = specs;
        expect(spec.name).toBe(route.replace(/-/g, '_'));
        expect(spec.risk).toBe('read');
        expect(spec.route?.method).toBe(READ_OVER_POST.has(route) ? 'POST' : 'GET');
        expect(spec.input).toBe(API_SCHEMAS[route as RouteName]);
        expect(spec.output).toBe(isStreaming(route) ? 'rows' : 'object');
    });

    it.each(READ_ROUTES)('%s is gated like its route', route => {
        const specs = specsFor(route);
        if (specs.length === 0) return;
        const [spec] = specs;
        const routeFlags = flagsOfRoute(route);
        if (routeFlags.length <= 1) {
            expect(spec.requires.flags).toEqual(routeFlags);
        } else {
            // withFeature passes when any mapped flag is on; toolVisibility needs all listed flags, so list one of them.
            expect(spec.requires.flags).toHaveLength(1);
            expect(routeFlags).toContain(spec.requires.flags[0]);
        }
        expect(spec.requires.role).toBe(routeSource(route).includes('withAdmin(') ? Role.ADMIN : undefined);
    });

    it('points every read feature tool at a read route', () => {
        const readSpecs = featureSpecs().filter(spec => spec.risk === 'read');
        expect(readSpecs.length).toBeGreaterThan(0);
        for (const spec of readSpecs) expect(READ_ROUTES).toContain(spec.route?.path.replace('/api/feature/', ''));
    });

    it('never registers a read tool for a write route', () => {
        for (const route of WRITE_ROUTES) for (const spec of specsFor(route)) expect(spec.risk).not.toBe('read');
    });

    it('registers the core data tools as always on', () => {
        for (const name of ['find_tools', 'run_sql', 'refresh_handle']) {
            expect(allTools().find(tool => tool.spec.name === name)?.spec.alwaysOn).toBe(true);
        }
    });

    it('keeps em dashes out of descriptions and call summaries', () => {
        for (const spec of READ_TOOL_SPECS) {
            expect(spec.description).not.toContain(EM_DASH);
            expect(spec.describeCall({})).not.toContain(EM_DASH);
            expect(spec.describeCall({ scope: 'user.jdoe', name: 'file.root', id: 'r1', rse: 'CERN-PROD', account: 'jdoe' })).not.toContain(EM_DASH);
        }
    });
    it('converts every read spec input schema to a JSON object schema', () => {
        expect(READ_TOOL_SPECS).toHaveLength(34);
        for (const spec of READ_TOOL_SPECS) {
            const schema = convertSchemaToJsonSchema(spec.input as never) as { type?: string } | undefined;
            expect(schema?.type).toBe('object');
        }
    });

    it('says "required" for list_dids type and the account argument of the account tools', () => {
        const byName = (name: string) => READ_TOOL_SPECS.find(spec => spec.name === name)?.description ?? '';
        expect(byName('list_dids')).toMatch(/`type`[^.]*required|required[^.]*`type`/i);
        for (const name of ['get_account_quotas', 'list_account_attributes', 'list_account_identities', 'list_subscription', 'get_subscription']) {
            expect(byName(name)).toMatch(/`account`[^.]*required|required[^.]*`account`/i);
        }
    });

    it('never mentions credentials in tool descriptions and tells the model not to ask for them', () => {
        for (const spec of READ_TOOL_SPECS) expect(spec.description).not.toMatch(/token|cookie|password|credential/i);
        expect(ASSISTANT_DATA_TOOLS_PROMPT).toMatch(/own session/i);
        expect(ASSISTANT_DATA_TOOLS_PROMPT).toMatch(/never ask[^.]*credentials/i);
        expect(ASSISTANT_DATA_TOOLS_PROMPT).not.toContain(EM_DASH);
    });
});
