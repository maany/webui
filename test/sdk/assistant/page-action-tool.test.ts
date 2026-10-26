import { z } from 'zod';
import { createPageActionTool, PageActionResult } from '@/lib/infrastructure/assistant/tools/page/page-action';
import { createPageTools, PAGE_TOOL_NAMES, registerPageTools } from '@/lib/infrastructure/assistant/tools/page';
import { MOBILE_MEDIA_QUERY } from '@/lib/infrastructure/assistant/tools/page/page-tool-utils';
import { allTools, getTool } from '@/lib/infrastructure/assistant/tool-registry';
import { FakePageActionRegistry } from 'test/fixtures/fake-page-action-registry';
import { makeTestToolContext } from 'test/fixtures/page-tool-context';

const tool = createPageActionTool();

function pageWithFilter(apply: (args: { state: string }) => Promise<string> = async args => `Showing ${args.state} rules.`) {
    const registry = new FakePageActionRegistry();
    registry.register({ name: 'rules.filter', description: 'Filter rules', schema: z.object({ state: z.enum(['OK', 'Stuck']) }), apply });
    return registry;
}

describe('page_action tool', () => {
    it('is an always-on read tool', () => {
        expect(tool.spec).toMatchObject({ name: 'page_action', domain: 'core', risk: 'read', executor: 'page', alwaysOn: true });
        expect(tool.spec.describeCall({ name: 'rules.filter', args: {} })).toBe('Run page action rules.filter');
        expect(() => z.toJSONSchema(tool.spec.input)).not.toThrow();
    });

    it('runs the action and returns its outcome', async () => {
        const registry = pageWithFilter();
        const result = (await tool.execute(
            { name: 'rules.filter', args: { state: 'Stuck' } },
            makeTestToolContext({ pages: registry }),
        )) as PageActionResult;
        expect(result).toEqual({ action: 'rules.filter', outcome: 'Showing Stuck rules.', actions: registry.list() });
    });

    it('returns invalid_args for arguments the page schema rejects', async () => {
        const apply = jest.fn(async () => 'never');
        const result = await tool.execute({ name: 'rules.filter', args: { state: 'Broken' } }, makeTestToolContext({ pages: pageWithFilter(apply) }));
        expect(result).toMatchObject({ error: 'invalid_args' });
        expect(apply).not.toHaveBeenCalled();
    });

    it('treats a raw ZodError from the registry as invalid_args', async () => {
        const registry = new FakePageActionRegistry();
        registry.invoke = async () => {
            throw z.object({ state: z.string() }).safeParse({}).error;
        };
        await expect(tool.execute({ name: 'rules.filter', args: {} }, makeTestToolContext({ pages: registry }))).resolves.toMatchObject({
            error: 'invalid_args',
        });
    });

    it('lists the available actions when the name is unknown', async () => {
        const result = await tool.execute({ name: 'rules.delete', args: {} }, makeTestToolContext({ pages: pageWithFilter() }));
        expect(result).toMatchObject({ error: 'not_found' });
        expect((result as { message: string }).message).toContain('Available actions: rules.filter.');
    });

    it('passes typed errors from the action through and maps other errors to unavailable', async () => {
        const typed = pageWithFilter(async () => {
            throw { error: 'session_expired', message: 'Log in again.' };
        });
        await expect(tool.execute({ name: 'rules.filter', args: { state: 'OK' } }, makeTestToolContext({ pages: typed }))).resolves.toEqual({
            error: 'session_expired',
            message: 'Log in again.',
        });

        const crashing = pageWithFilter(async () => {
            throw new Error('Grid not ready');
        });
        await expect(tool.execute({ name: 'rules.filter', args: { state: 'OK' } }, makeTestToolContext({ pages: crashing }))).resolves.toEqual({
            error: 'unavailable',
            message: 'Grid not ready',
        });
    });

    it('minimizes the panel on mobile after a successful action', async () => {
        const original = window.matchMedia;
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            configurable: true,
            value: jest.fn((query: string) => ({ matches: query === MOBILE_MEDIA_QUERY, media: query })),
        });
        const minimizePanel = jest.fn();
        await tool.execute({ name: 'rules.filter', args: { state: 'OK' } }, makeTestToolContext({ pages: pageWithFilter(), minimizePanel }));
        expect(minimizePanel).toHaveBeenCalledTimes(1);
        Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: original });
    });
});

describe('page tool registration', () => {
    it('creates the three core page tools', () => {
        expect(createPageTools().map(registered => registered.spec.name)).toEqual([...PAGE_TOOL_NAMES]);
        createPageTools().forEach(registered => {
            expect(registered.spec.alwaysOn).toBe(true);
            expect(registered.spec.risk).toBe('read');
            expect(registered.spec.description).not.toContain('\u2014');
        });
    });

    it('registers once even when called twice', () => {
        registerPageTools();
        registerPageTools();
        PAGE_TOOL_NAMES.forEach(name => {
            expect(getTool(name)).toBeDefined();
            expect(allTools().filter(registered => registered.spec.name === name)).toHaveLength(1);
        });
    });
});
