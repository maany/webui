import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ListDIDClient } from '@/app/(rucio)/dids/ListDIDClient';
import { ListRuleClient } from '@/app/(rucio)/rules/ListRuleClient';
import { ListRSEClient } from '@/app/(rucio)/rses/ListRSEClient';
import { ListSubscriptionClient } from '@/app/(rucio)/subscriptions/ListSubscriptionClient';
import { attachPageActionRegistry } from '@/lib/infrastructure/assistant/page-action-bridge';
import { buildDIDSearchUrl, buildRuleSearchUrl } from '@/lib/infrastructure/utils/navigation';
import { DIDType } from '@/lib/core/entity/rucio';
import { FakePageActionRegistry } from 'test/fixtures/fake-page-action-registry';

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockMounts = jest.fn();
const mockSearchStart = jest.fn();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: mockReplace, push: mockPush }),
    usePathname: () => '/list',
}));

function mockList(name: string, pick: (props: Record<string, unknown>) => Record<string, unknown>) {
    const React = require('react');
    return (props: Record<string, unknown>) => {
        React.useEffect(() => {
            mockMounts(name);
        }, []);
        return <pre data-testid={name}>{JSON.stringify(pick(props))}</pre>;
    };
}

jest.mock('@/component-library/pages/DID/list/ListDID', () => ({
    ListDID: mockList('ListDID', p => ({ firstPattern: p.firstPattern, autoSearch: p.autoSearch, initialType: p.initialType })),
}));
jest.mock('@/component-library/pages/Rule/list/ListRule', () => ({
    ListRule: mockList('ListRule', p => {
        const onSearchStart = p.onSearchStart as (filters: Record<string, unknown>) => void;
        mockSearchStart.mockImplementation(() => onSearchStart({ account: 'jdoe', scope: '*', name: '', activity: '' }));
        return { autoSearch: p.autoSearch, initialFilters: p.initialFilters };
    }),
}));
jest.mock('@/component-library/pages/RSE/list/ListRSE', () => ({
    ListRSE: mockList('ListRSE', p => ({ initialExpression: p.initialExpression, autoSearch: p.autoSearch })),
}));
jest.mock('@/component-library/pages/Subscriptions/list/ListSubscription', () => ({
    ListSubscription: mockList('ListSubscription', p => ({ accountFilter: p.accountFilter, autoSearch: p.autoSearch })),
}));

const shown = (testId: string) => JSON.parse(screen.getByTestId(testId).textContent ?? '{}');

describe('list page actions', () => {
    let registry: FakePageActionRegistry;
    let detach: () => void;

    beforeEach(() => {
        jest.clearAllMocks();
        registry = new FakePageActionRegistry();
        detach = attachPageActionRegistry(registry);
    });

    afterEach(() => act(() => detach()));

    it('dids.search runs a new search and keeps the URL in sync', async () => {
        render(<ListDIDClient />);
        expect(registry.list().map(action => action.name)).toEqual(['dids.search']);

        let outcome = '';
        await act(async () => {
            outcome = await registry.invoke('dids.search', { scope: 'user.jdoe', name: 'data*', type: 'dataset' });
        });

        expect(outcome).toContain('user.jdoe:data*');
        expect(mockReplace).toHaveBeenCalledWith(buildDIDSearchUrl({ scope: 'user.jdoe', name: 'data*', type: DIDType.DATASET }), { scroll: false });
        expect(shown('ListDID')).toEqual({ firstPattern: 'user.jdoe:data*', autoSearch: true, initialType: DIDType.DATASET });
        expect(mockMounts.mock.calls.filter(([name]) => name === 'ListDID')).toHaveLength(2);
    });

    it('rules.filter remounts the rule list with the new filters', async () => {
        render(<ListRuleClient autoSearch={false} initialFilters={{ scope: '*' }} />);

        await act(async () => {
            await registry.invoke('rules.filter', { account: 'jdoe', state: 'Stuck' });
        });

        expect(mockReplace).toHaveBeenCalledWith(buildRuleSearchUrl({ account: 'jdoe', state: 'Stuck' }), { scroll: false });
        expect(shown('ListRule')).toEqual({
            autoSearch: true,
            initialFilters: { account: 'jdoe', scope: '*', name: '', activity: '', state: 'Stuck' },
        });
        expect(mockMounts.mock.calls.filter(([name]) => name === 'ListRule')).toHaveLength(2);

        await act(async () => {
            await registry.invoke('rules.filter', { scope: 'user.jdoe', state: 'OK' });
        });

        expect(mockReplace).toHaveBeenCalledTimes(2);
        expect(shown('ListRule')).toEqual({
            autoSearch: true,
            initialFilters: { account: '', scope: 'user.jdoe', name: '', activity: '', state: 'OK' },
        });
        expect(mockMounts.mock.calls.filter(([name]) => name === 'ListRule')).toHaveLength(3);
    });

    it('rules.filter rejects an invalid account filter', async () => {
        render(<ListRuleClient />);
        await expect(registry.invoke('rules.filter', { account: 'Not Valid!' })).rejects.toMatchObject({ error: 'invalid_args' });
        await act(async () => {
            await registry.invoke('rules.filter', { account: 'jd*' });
        });
        expect(mockReplace).toHaveBeenCalledTimes(1);
    });

    it('dids.search rejects a colon in the scope and changes nothing', async () => {
        render(<ListDIDClient />);
        await expect(registry.invoke('dids.search', { scope: 'user:jdoe', name: 'data*' })).rejects.toMatchObject({ error: 'invalid_args' });
        expect(mockReplace).not.toHaveBeenCalled();
        expect(mockMounts.mock.calls.filter(([name]) => name === 'ListDID')).toHaveLength(1);
    });

    it('rules.filter rejects an empty filter without touching the page', async () => {
        render(<ListRuleClient />);
        await expect(registry.invoke('rules.filter', {})).rejects.toMatchObject({ error: 'invalid_args' });
        expect(mockReplace).not.toHaveBeenCalled();
        expect(mockMounts).toHaveBeenCalledTimes(1);
    });

    it('rses.filter lists the RSEs of an expression', async () => {
        render(<ListRSEClient />);
        expect(shown('ListRSE')).toEqual({});

        await act(async () => {
            await registry.invoke('rses.filter', { expression: 'tier=1' });
        });

        expect(mockReplace).toHaveBeenCalledWith('/rses?expression=tier%3D1&autoSearch=true', { scroll: false });
        expect(shown('ListRSE')).toEqual({ initialExpression: 'tier=1', autoSearch: true });
    });

    it('subscriptions.filter lists the subscriptions of another account', async () => {
        render(
            <QueryClientProvider client={new QueryClient()}>
                <ListSubscriptionClient accountFilter="root" autoSearch={true} />
            </QueryClientProvider>,
        );

        mockReplace.mockClear();

        await act(async () => {
            await registry.invoke('subscriptions.filter', { account: 'jdoe' });
        });

        expect(mockReplace).toHaveBeenLastCalledWith('/subscriptions?account=jdoe&autoSearch=true', { scroll: false });
        expect(mockReplace).toHaveBeenCalledTimes(1);
        expect(shown('ListSubscription')).toEqual({ accountFilter: 'jdoe', autoSearch: true });
        await expect(registry.invoke('subscriptions.filter', { account: 'Not Valid!' })).rejects.toMatchObject({ error: 'invalid_args' });
        expect(mockReplace).toHaveBeenCalledTimes(1);
    });

    it('subscriptions.filter does not win over a later, different accountFilter prop', async () => {
        const tree = (accountFilter: string) => (
            <QueryClientProvider client={new QueryClient()}>
                <ListSubscriptionClient accountFilter={accountFilter} autoSearch={true} />
            </QueryClientProvider>
        );
        const { rerender } = render(tree('root'));

        await act(async () => {
            await registry.invoke('subscriptions.filter', { account: 'jdoe' });
        });
        expect(shown('ListSubscription').accountFilter).toBe('jdoe');

        rerender(tree('alice'));
        expect(shown('ListSubscription').accountFilter).toBe('alice');
    });

    it('a user search after an action still pushes the URL', async () => {
        render(<ListRuleClient />);
        await act(async () => {
            await registry.invoke('rules.filter', { account: 'jdoe' });
        });
        mockPush.mockClear();
        act(() => {
            mockSearchStart();
        });
        expect(mockPush).toHaveBeenCalledTimes(1);
    });

    it('unregisters when the list page unmounts', () => {
        const { unmount } = render(<ListRSEClient />);
        expect(registry.list()).toHaveLength(1);
        unmount();
        expect(registry.list()).toEqual([]);
    });
});
