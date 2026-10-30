import { z } from 'zod';
import { Role } from '@/lib/core/entity/auth-models';
import { RuleState } from '@/lib/core/entity/rucio';
import { createNavigateTool, NavigateResult } from '@/lib/infrastructure/assistant/tools/page/navigate';
import { MOBILE_MEDIA_QUERY } from '@/lib/infrastructure/assistant/tools/page/page-tool-utils';
import { FakePageActionRegistry } from 'test/fixtures/fake-page-action-registry';
import { allFlags, makeTestToolContext } from 'test/fixtures/page-tool-context';

const tool = createNavigateTool({ waitMs: 1000, pollMs: 5 });

function offer(registry: FakePageActionRegistry, name: string): () => void {
    return registry.register({ name, description: name, schema: z.object({}), apply: async () => 'done' });
}

function routerThatLands(registry: FakePageActionRegistry, actionName?: string) {
    return jest.fn((url: string) => {
        window.history.pushState({}, '', url);
        if (actionName) setTimeout(() => offer(registry, actionName), 30);
    });
}

describe('navigate tool', () => {
    beforeEach(() => {
        window.history.pushState({}, '', '/dashboard');
    });

    it('is an always-on read tool in the core domain', () => {
        expect(tool.spec).toMatchObject({ name: 'navigate', domain: 'core', risk: 'read', executor: 'page', output: 'object', alwaysOn: true });
        expect(tool.spec.requires).toEqual({ flags: [] });
        expect(tool.spec.describeCall({ page: 'rule', params: { id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' } })).toBe(
            'Open rule a1b2c3d4e5f60718293a4b5c6d7e8f90',
        );
        expect(() => z.toJSONSchema(tool.spec.input)).not.toThrow();
    });

    it('opens the page, waits for its actions and returns them', async () => {
        const registry = new FakePageActionRegistry();
        const navigate = routerThatLands(registry, 'rule_create.prefill');
        const result = (await tool.execute({ page: 'rule_create' }, makeTestToolContext({ pages: registry, navigate }))) as NavigateResult;

        expect(navigate).toHaveBeenCalledWith('/rule/create');
        expect(result.url).toBe('/rule/create');
        expect(result.navigated).toBe(true);
        expect(result.actions.map(action => action.name)).toEqual(['rule_create.prefill']);
        expect(result.note).toBeUndefined();
    });

    it('ignores actions left by the previous page', async () => {
        const registry = new FakePageActionRegistry();
        offer(registry, 'rules.filter');
        const navigate = routerThatLands(registry, 'dids.search');
        const result = (await tool.execute({ page: 'dids' }, makeTestToolContext({ pages: registry, navigate }))) as NavigateResult;

        expect(result.actions.map(action => action.name)).toEqual(['dids.search']);
    });

    it('does not report actions of a previous list page on pages without actions', async () => {
        const registry = new FakePageActionRegistry();
        offer(registry, 'rules.filter');
        const navigate = routerThatLands(registry);
        const result = (await tool.execute(
            { page: 'rule', params: { id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' } },
            makeTestToolContext({ pages: registry, navigate }),
        )) as NavigateResult;
        expect(result.actions).toEqual([]);
    });

    it('returns right away for pages that offer no actions', async () => {
        const registry = new FakePageActionRegistry();
        const navigate = routerThatLands(registry);
        const started = Date.now();
        const result = (await createNavigateTool({ waitMs: 2000, pollMs: 5 }).execute(
            { page: 'rule', params: { id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' } },
            makeTestToolContext({ pages: registry, navigate }),
        )) as NavigateResult;

        expect(result).toEqual({ url: '/rule/a1b2c3d4e5f60718293a4b5c6d7e8f90', navigated: true, actions: [] });
        expect(Date.now() - started).toBeLessThan(500);
    });

    it('says so when the page offers no actions in time', async () => {
        const registry = new FakePageActionRegistry();
        const navigate = routerThatLands(registry);
        const result = (await createNavigateTool({ waitMs: 100, pollMs: 5 }).execute(
            { page: 'rses' },
            makeTestToolContext({ pages: registry, navigate }),
        )) as NavigateResult;

        expect(result.navigated).toBe(true);
        expect(result.actions).toEqual([]);
        expect(result.note).toContain('read_current_page');
    });

    it('says so when the page does not load', async () => {
        const navigate = jest.fn();
        const result = (await createNavigateTool({ waitMs: 100, pollMs: 5 }).execute(
            { page: 'rule_create' },
            makeTestToolContext({ navigate }),
        )) as NavigateResult;

        expect(result.navigated).toBe(true);
        expect(result.note).toContain('did not finish loading');
    });

    it('does not navigate to the page the user is already on', async () => {
        window.history.pushState({}, '', '/rules?autoSearch=true&state=OK');
        const navigate = jest.fn();
        const registry = new FakePageActionRegistry();
        offer(registry, 'rules.filter');
        const result = (await tool.execute(
            { page: 'rules', params: { state: RuleState.STUCK } },
            makeTestToolContext({ pages: registry, navigate }),
        )) as NavigateResult;

        expect(navigate).not.toHaveBeenCalled();
        expect(result.navigated).toBe(false);
        expect(result.actions.map(action => action.name)).toEqual(['rules.filter']);
        expect(result.note).toContain('page_action');
    });

    it('does not mention page_action when the page has no actions', async () => {
        window.history.pushState({}, '', '/account/jdoe');
        const navigate = jest.fn();
        const result = (await tool.execute(
            { page: 'account', params: { account: 'jdoe', tab: 'quotas' } },
            makeTestToolContext({ navigate }),
        )) as NavigateResult;
        expect(navigate).not.toHaveBeenCalled();
        expect(result.navigated).toBe(false);
        expect(result.actions).toEqual([]);
        expect(result.note).toContain('already on');
        expect(result.note).not.toContain('page_action');
    });

    it('refuses pages that are off or not allowed before navigating', async () => {
        const navigate = jest.fn();
        await expect(
            tool.execute({ page: 'rules' }, makeTestToolContext({ navigate, flags: { ...allFlags(), rules: false } })),
        ).resolves.toMatchObject({
            error: 'unavailable',
        });
        await expect(tool.execute({ page: 'accounts' }, makeTestToolContext({ navigate, role: Role.USER }))).resolves.toMatchObject({
            error: 'forbidden',
        });
        await expect(tool.execute({ page: 'did' }, makeTestToolContext({ navigate }))).resolves.toMatchObject({ error: 'invalid_args' });
        expect(navigate).not.toHaveBeenCalled();
    });

    it('refuses built URLs that could leave the app pages', async () => {
        const navigate = jest.fn();
        await expect(tool.execute({ page: 'did', params: { scope: '..', name: 'auth' } }, makeTestToolContext({ navigate }))).resolves.toMatchObject({
            error: 'invalid_args',
        });
        await expect(tool.execute({ page: 'rule', params: { id: '..' } }, makeTestToolContext({ navigate }))).resolves.toMatchObject({
            error: 'invalid_args',
        });
        expect(navigate).not.toHaveBeenCalled();
    });

    it('stops when aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        const navigate = jest.fn();
        await expect(tool.execute({ page: 'rule_create' }, makeTestToolContext({ navigate, signal: controller.signal }))).resolves.toMatchObject({
            error: 'aborted',
        });
        expect(navigate).not.toHaveBeenCalled();
    });

    describe('on mobile', () => {
        const original = window.matchMedia;

        afterEach(() => {
            Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: original });
        });

        it.each([
            [true, 1],
            [false, 0],
        ])('minimizes the panel when mobile is %s', async (mobile, calls) => {
            Object.defineProperty(window, 'matchMedia', {
                writable: true,
                configurable: true,
                value: jest.fn((query: string) => ({ matches: mobile && query === MOBILE_MEDIA_QUERY, media: query })),
            });
            const registry = new FakePageActionRegistry();
            const minimizePanel = jest.fn();
            await tool.execute(
                { page: 'rule', params: { id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' } },
                makeTestToolContext({ pages: registry, navigate: routerThatLands(registry), minimizePanel }),
            );
            expect(minimizePanel).toHaveBeenCalledTimes(calls);
        });
    });

    it('writes notes without em dashes', async () => {
        const navigate = jest.fn();
        const result = await createNavigateTool({ waitMs: 50, pollMs: 5 }).execute({ page: 'rule_create' }, makeTestToolContext({ navigate }));
        expect(JSON.stringify(result)).not.toContain('\u2014');
    });
});
