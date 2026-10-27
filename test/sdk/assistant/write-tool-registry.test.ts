import fs from 'fs';
import { convertSchemaToJsonSchema } from '@tanstack/ai';
import path from 'path';
import { Role } from '@/lib/core/entity/auth-models';
import { toolVisibility, type ToolVisibilityContext } from '@/lib/core/services/assistant-policy';
import { CONTROLLER_FLAG_MAP } from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import { INVALIDATION_MAP } from '@/lib/infrastructure/query/invalidation-map';
import { WRITE_TOOLS } from '@/lib/infrastructure/assistant/tools/write-tools';
import { buildTanstackTools } from '@/lib/infrastructure/assistant/tanstack-tools';
import { makeToolContextFactory } from 'test/fixtures/assistant-fixtures';
import { ALL_FLAGS_ON, SAMPLE_WRITE_ARGS, flagsWithout } from 'test/fixtures/assistant-write-fixtures';

const FEATURE_DIR = path.resolve(__dirname, '../../../src/app/api/feature');
const EM_DASH = String.fromCharCode(0x2014);
// add-account-attribute and update-account-attribute are high risk because admin=True makes the account a Rucio admin.
const HIGH_RISK = [
    'declare-bad-replicas',
    'delete-account',
    'delete-account-identity',
    'add-account-identity',
    'add-account-attribute',
    'update-account-attribute',
];

interface RouteInfo {
    dir: string;
    methods: string[];
    controller?: string;
    admin: boolean;
}

function readRoute(dir: string): RouteInfo {
    const source = fs.readFileSync(path.join(FEATURE_DIR, dir, 'route.ts'), 'utf8');
    const methods = Array.from(source.matchAll(/export (?:const|async function) (GET|POST|PUT|DELETE)\b/g)).map(match => match[1]);
    const controller = /withFeature\(CONTROLLERS\.([A-Z_]+)/.exec(source)?.[1];
    return { dir, methods, controller, admin: /withAdmin\(/.test(source) };
}

/** Same split as phase 2's read-tool-registry.test.ts: not tools, and the one read route that uses POST. */
const NOT_TOOLS = new Set(['template-stream', 'get-assistant-config']);
const READ_OVER_POST = new Set(['list-account-rse-quotas']);

const routes = fs
    .readdirSync(FEATURE_DIR)
    .filter(dir => fs.existsSync(path.join(FEATURE_DIR, dir, 'route.ts')))
    .filter(dir => !dir.startsWith('mock-') && !NOT_TOOLS.has(dir))
    .map(readRoute);
const writeRoutes = routes.filter(route => !READ_OVER_POST.has(route.dir) && route.methods.length > 0 && !route.methods.includes('GET'));

function controllerFlags(name: string | undefined): string[] {
    if (!name) return [];
    const symbol = (CONTROLLERS as unknown as Record<string, symbol>)[name];
    return [...((CONTROLLER_FLAG_MAP.get(symbol) ?? []) as string[])];
}

const toolFor = (dir: string) => WRITE_TOOLS.filter(tool => tool.spec.route?.path === `/api/feature/${dir}`);

describe('write tool registry', () => {
    it('finds the write routes on disk (counted, not hard coded)', () => {
        expect(writeRoutes.length).toBeGreaterThan(0);
        HIGH_RISK.forEach(dir => expect(writeRoutes.map(route => route.dir)).toContain(dir));
    });

    it('has exactly one tool per write route and no extra tools', () => {
        writeRoutes.forEach(route => expect(toolFor(route.dir)).toHaveLength(1));
        expect(WRITE_TOOLS).toHaveLength(writeRoutes.length);
        expect(new Set(WRITE_TOOLS.map(tool => tool.spec.name)).size).toBe(WRITE_TOOLS.length);
    });

    it.each(writeRoutes.map(route => route.dir))('%s: name, method, risk, flags, role and invalidation match the route', dir => {
        const route = readRoute(dir);
        const [tool] = toolFor(dir);
        const { spec } = tool;
        expect(spec.name).toBe(dir.replace(/-/g, '_'));
        expect(spec.route?.method).toBe(route.methods[0]);
        expect(spec.executor).toBe('feature');
        expect(spec.output).toBe('object');
        expect(spec.alwaysOn).toBeFalsy();
        expect(spec.risk).toBe(HIGH_RISK.includes(dir) ? 'high' : 'write');

        const routeFlags = controllerFlags(route.controller);
        expect(routeFlags.length).toBeLessThanOrEqual(1); // withFeature ORs flags, requires.flags ANDs them
        expect(spec.requires.flags.filter(flag => !flag.startsWith('assistant'))).toEqual(routeFlags);
        expect(spec.requires.role).toBe(route.admin ? Role.ADMIN : undefined);

        expect(INVALIDATION_MAP[dir]).toBeDefined();
    });

    it('declare_bad_replicas also needs assistant.bad_replicas', () => {
        const [tool] = toolFor('declare-bad-replicas');
        expect(tool.spec.requires.flags).toContain('assistant.bad_replicas');
    });

    it.each(writeRoutes.map(route => route.dir))('%s: the sample args pass the schema and the summary is one line without an em dash', dir => {
        const [tool] = toolFor(dir);
        const args = tool.spec.input.parse(SAMPLE_WRITE_ARGS[tool.spec.name]);
        const summary = tool.spec.describeCall(args);
        expect(summary.length).toBeGreaterThan(0);
        expect(summary).not.toContain('\n');
        expect(summary).not.toContain(EM_DASH);
    });

    it('add_account_identity marks the password as sensitive', () => {
        const [tool] = toolFor('add-account-identity');
        expect(tool.spec.sensitiveArgs).toEqual(['password']);
        expect(tool.spec.describeCall(tool.spec.input.parse(SAMPLE_WRITE_ARGS.add_account_identity))).not.toContain('s3cret');
    });
});

describe('write tool visibility', () => {
    const admin: ToolVisibilityContext = { flags: ALL_FLAGS_ON, role: Role.ADMIN, permissionsReady: true };
    const visibleNames = (ctx: ToolVisibilityContext) =>
        WRITE_TOOLS.filter(tool => toolVisibility(tool.spec, ctx).visible)
            .map(tool => tool.spec.name)
            .sort();

    it('shows every write tool to an admin with every flag on', () => {
        expect(visibleNames(admin)).toHaveLength(WRITE_TOOLS.length);
    });

    it('hides every write tool without assistant.write', () => {
        const ctx = { ...admin, flags: flagsWithout('assistant.write') };
        WRITE_TOOLS.forEach(tool => expect(toolVisibility(tool.spec, ctx)).toEqual({ visible: false, reason: 'flag' }));
    });

    it('hides only declare_bad_replicas without assistant.bad_replicas', () => {
        const ctx = { ...admin, flags: flagsWithout('assistant.bad_replicas') };
        expect(visibleNames(ctx)).toHaveLength(WRITE_TOOLS.length - 1);
        expect(visibleNames(ctx)).not.toContain('declare_bad_replicas');
    });

    it('hides the account tools from non-admins with reason role', () => {
        const ctx = { ...admin, role: Role.USER };
        expect(visibleNames(ctx)).toEqual(['add_did', 'attach_dids', 'create_rule', 'declare_bad_replicas', 'set_did_status', 'update_rule']);
        const deleteAccount = WRITE_TOOLS.find(tool => tool.spec.name === 'delete_account');
        expect(deleteAccount && toolVisibility(deleteAccount.spec, ctx)).toEqual({ visible: false, reason: 'role' });
    });

    it('hides a tool when its route flag is off', () => {
        expect(visibleNames({ ...admin, flags: flagsWithout('rules.create') })).not.toContain('create_rule');
    });

    it('hides everything until permix is ready', () => {
        expect(visibleNames({ ...admin, permissionsReady: false })).toEqual([]);
    });
});

describe('write tool wiring for TanStack (PF12)', () => {
    it('converts every write spec input to a JSON object schema', () => {
        for (const tool of WRITE_TOOLS) {
            const schema = convertSchemaToJsonSchema(tool.spec.input as never) as { type?: string } | undefined;
            expect(schema?.type).toBe('object');
        }
    });

    it('builds every write tool as an ask tool without throwing', () => {
        const controller = new AbortController();
        const makeContext = makeToolContextFactory(controller.signal);
        const built = buildTanstackTools(WRITE_TOOLS, {
            policyFor: () => 'ask',
            makeToolContext: toolCallId => makeContext(toolCallId, 'turn-1'),
            onResult: jest.fn(),
        });
        expect(built.serverTools).toHaveLength(WRITE_TOOLS.length);
        expect(built.approvalClientTools).toHaveLength(WRITE_TOOLS.length);
        WRITE_TOOLS.forEach(tool => expect(built.builtPolicy.get(tool.spec.name)).toBe('ask'));
        built.serverTools.forEach(tool => expect((tool as unknown as { needsApproval?: boolean }).needsApproval).toBe(true));
    });
});
