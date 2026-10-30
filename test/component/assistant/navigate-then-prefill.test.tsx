import React, { useEffect, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Page from '@/app/(rucio)/rule/create/page';
import { attachPageActionRegistry } from '@/lib/infrastructure/assistant/page-action-bridge';
import { createNavigateTool, NavigateResult } from '@/lib/infrastructure/assistant/tools/page/navigate';
import { createPageActionTool, PageActionResult } from '@/lib/infrastructure/assistant/tools/page/page-action';
import { DIDType } from '@/lib/core/entity/rucio';
import { FakePageActionRegistry } from 'test/fixtures/fake-page-action-registry';
import { makeTestToolContext } from 'test/fixtures/page-tool-context';
import { ndjsonResponse } from 'test/fixtures/ndjson-response';

jest.mock('@/component-library/pages/Rule/create/stage-dids/CreateRuleStageData', () => ({
    CreateRuleStageData: () => <div data-testid="stage-dids" />,
}));
jest.mock('@/component-library/pages/Rule/create/stage-rses/CreateRuleStageStorage', () => ({
    CreateRuleStageStorage: () => <div data-testid="stage-rses" />,
}));
jest.mock('@/component-library/pages/Rule/create/stage-options/CreateRuleStageOptions', () => ({
    CreateRuleStageOptions: () => <div data-testid="stage-options" />,
}));
jest.mock('@/component-library/pages/Rule/create/stage-summary/CreateRuleStageSummary', () => ({
    CreateRuleStageSummary: (props: { parameters: { dids: { scope: string; name: string }[]; rses: { rse: string }[] } }) => (
        <div data-testid="stage-summary">
            {props.parameters.dids.map(d => `${d.scope}:${d.name}`).join(',')}|{props.parameters.rses.map(r => r.rse).join(',')}
        </div>
    ),
}));
jest.mock('@/component-library/pages/Rule/create/stage-submission/CreateRuleStageSubmission', () => ({
    CreateRuleStageSubmission: () => <div data-testid="stage-submission" />,
}));

const didRow = { status: 'success', scope: 'user.jdoe', name: 'file1', did_type: DIDType.FILE, bytes: 1000, length: 1, open: false };
const quotaRow = {
    status: 'success',
    rse: 'CERN-PROD',
    rse_id: '1',
    account: 'jdoe',
    files: 0,
    used_bytes: 0,
    bytes_limit: 10_000,
    bytes_remaining: 10_000,
    has_quota: true,
    total_expected_usage: 1000,
};

const defaultRoutes = async (url: string, _init?: RequestInit) => {
    if (url.startsWith('/api/feature/list-dids?')) return ndjsonResponse([didRow]);
    if (url === '/api/feature/list-account-rse-quotas') return ndjsonResponse([quotaRow]);
    throw new Error(`unexpected fetch ${url}`);
};
const fetchRoutes = jest.fn(defaultRoutes);

/** Stands in for the App Router: renders the wizard page when the URL is /rule/create. */
const Harness = () => {
    const [path, setPath] = useState(window.location.pathname);
    useEffect(() => {
        const onChange = () => setPath(window.location.pathname);
        window.addEventListener('popstate', onChange);
        return () => window.removeEventListener('popstate', onChange);
    }, []);
    return path === '/rule/create' ? <Page /> : <p>Dashboard</p>;
};

const routerPush = (url: string) => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
};

type ActGlobal = { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = (globalThis as ActGlobal).IS_REACT_ACT_ENVIRONMENT;
const originalFetch = global.fetch;

describe('navigate, then prefill the create rule wizard', () => {
    let registry: FakePageActionRegistry;
    let detach: () => void;

    beforeAll(() => {
        // The tools run outside act, like in the app; let React schedule renders on its own.
        (globalThis as ActGlobal).IS_REACT_ACT_ENVIRONMENT = false;
    });

    afterAll(() => {
        (globalThis as ActGlobal).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
        (global as unknown as { fetch: unknown }).fetch = originalFetch;
    });

    beforeEach(() => {
        localStorage.clear();
        fetchRoutes.mockClear();
        fetchRoutes.mockImplementation(defaultRoutes);
        (global as unknown as { fetch: unknown }).fetch = fetchRoutes;
        window.history.pushState({}, '', '/dashboard');
        registry = new FakePageActionRegistry();
        detach = attachPageActionRegistry(registry);
    });

    afterEach(() => detach());

    it('opens the wizard, sees its action and fills it', async () => {
        render(<Harness />);
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
        const ctx = makeTestToolContext({ pages: registry, navigate: routerPush });

        const navigation = (await createNavigateTool({ waitMs: 3000, pollMs: 10 }).execute({ page: 'rule_create' }, ctx)) as NavigateResult;
        expect(navigation.navigated).toBe(true);
        expect(navigation.actions.map(action => action.name)).toContain('rule_create.prefill');

        const applied = (await createPageActionTool().execute(
            { name: 'rule_create.prefill', args: { dids: ['user.jdoe:file1'], rseExpression: 'tier=1' } },
            ctx,
        )) as PageActionResult;
        expect(applied.action).toBe('rule_create.prefill');
        expect(applied.outcome).toContain('Summary');

        expect(await screen.findByTestId('stage-summary')).toHaveTextContent('user.jdoe:file1|CERN-PROD');
        await waitFor(() => expect(JSON.parse(localStorage.getItem('create_rule_parameters') ?? '{}').dids?.[0]?.name).toBe('file1'));
        expect(localStorage.getItem('create_rule_active')).toBe('3');
    });

    it('returns invalid_args and leaves the wizard alone for bad args', async () => {
        window.history.pushState({}, '', '/rule/create');
        render(<Harness />);
        await waitFor(() => expect(registry.list().map(action => action.name)).toContain('rule_create.prefill'));

        const result = await createPageActionTool().execute(
            { name: 'rule_create.prefill', args: { dids: ['user.jdoe:*'], rseExpression: '' } },
            makeTestToolContext({ pages: registry }),
        );
        expect(result).toMatchObject({ error: 'invalid_args' });
        expect(fetchRoutes).not.toHaveBeenCalled();
        expect(screen.getByTestId('stage-dids')).toBeInTheDocument();
    });

    it('refuses a prefill while the wizard is submitting a rule', async () => {
        window.history.pushState({}, '', '/rule/create');
        render(<Harness />);
        await waitFor(() => expect(registry.list().map(action => action.name)).toContain('rule_create.prefill'));
        const ctx = makeTestToolContext({ pages: registry });
        const args = { dids: ['user.jdoe:file1'], rseExpression: 'tier=1' };

        await createPageActionTool().execute({ name: 'rule_create.prefill', args }, ctx);
        await screen.findByTestId('stage-summary');
        fireEvent.click(screen.getByRole('button', { name: /submit/i }));
        await screen.findByTestId('stage-submission');
        fetchRoutes.mockClear();

        const result = await createPageActionTool().execute({ name: 'rule_create.prefill', args }, ctx);
        expect(result).toMatchObject({ error: 'unavailable', message: expect.stringContaining('reload the create rule page') });
        expect(screen.getByTestId('stage-submission')).toBeInTheDocument();
    });

    it('refuses when the wizard reaches the submission stage while the DIDs are still resolving', async () => {
        window.history.pushState({}, '', '/rule/create');
        render(<Harness />);
        await waitFor(() => expect(registry.list().map(action => action.name)).toContain('rule_create.prefill'));
        const ctx = makeTestToolContext({ pages: registry });
        const args = { dids: ['user.jdoe:file1'], rseExpression: 'tier=1' };

        await createPageActionTool().execute({ name: 'rule_create.prefill', args }, ctx);
        await screen.findByTestId('stage-summary');

        let releaseFetch: () => void = () => undefined;
        const gate = new Promise<void>(resolve => {
            releaseFetch = resolve;
        });
        fetchRoutes.mockImplementation(async (url: string, init?: RequestInit) => {
            if (url.startsWith('/api/feature/list-dids?')) await gate;
            return defaultRoutes(url, init);
        });
        const pending = createPageActionTool().execute({ name: 'rule_create.prefill', args }, ctx);

        fireEvent.click(screen.getByRole('button', { name: /submit/i }));
        await screen.findByTestId('stage-submission');
        const savedParameters = localStorage.getItem('create_rule_parameters');

        releaseFetch();
        expect(await pending).toMatchObject({ error: 'unavailable', message: expect.stringContaining('reload the create rule page') });
        expect(screen.getByTestId('stage-submission')).toBeInTheDocument();
        expect(localStorage.getItem('create_rule_parameters')).toBe(savedParameters);
    });

    it('lets the newest of two racing prefills win', async () => {
        window.history.pushState({}, '', '/rule/create');
        render(<Harness />);
        await waitFor(() => expect(registry.list().map(action => action.name)).toContain('rule_create.prefill'));
        const ctx = makeTestToolContext({ pages: registry });

        let releaseFirst: () => void = () => undefined;
        const gate = new Promise<void>(resolve => {
            releaseFirst = resolve;
        });
        fetchRoutes.mockImplementation(async (url: string, _init?: RequestInit) => {
            if (url.startsWith('/api/feature/list-dids?')) {
                const name = new URLSearchParams(url.split('?')[1]).get('query')?.split(':')[1] ?? '';
                if (name === 'slow') await gate;
                return ndjsonResponse([{ ...didRow, name }]);
            }
            if (url === '/api/feature/list-account-rse-quotas') return ndjsonResponse([quotaRow]);
            throw new Error(`unexpected fetch ${url}`);
        });

        const first = createPageActionTool().execute(
            { name: 'rule_create.prefill', args: { dids: ['user.jdoe:slow'], rseExpression: 'tier=1' } },
            ctx,
        );
        const second = await createPageActionTool().execute(
            { name: 'rule_create.prefill', args: { dids: ['user.jdoe:fast'], rseExpression: 'tier=1' } },
            ctx,
        );
        expect(second).toMatchObject({ action: 'rule_create.prefill' });
        releaseFirst();
        expect(await first).toMatchObject({ error: 'aborted' });
        expect(await screen.findByTestId('stage-summary')).toHaveTextContent('user.jdoe:fast');
    });

    it('unregisters the action when the page unmounts', async () => {
        window.history.pushState({}, '', '/rule/create');
        const { unmount } = render(<Harness />);
        await waitFor(() => expect(registry.list()).toHaveLength(1));
        unmount();
        expect(registry.list()).toEqual([]);
    });
});
