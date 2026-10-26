import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DetailsSubscription } from '@/component-library/pages/Subscriptions/details/DetailsSubscription';
import { attachPageActionRegistry } from '@/lib/infrastructure/assistant/page-action-bridge';
import { SubscriptionState } from '@/lib/core/entity/rucio';
import { FakePageActionRegistry } from 'test/fixtures/fake-page-action-registry';

jest.mock('@/component-library/pages/Subscriptions/details/DetailsSubscriptionMeta', () => ({
    DetailsSubscriptionMeta: () => <div data-testid="subscription-meta" />,
}));
jest.mock('@/component-library/pages/Subscriptions/details/DetailsSubscriptionSections', () => ({
    DetailsSubscriptionSections: () => <div data-testid="subscription-sections" />,
}));
jest.mock('@/lib/infrastructure/hooks/useToast', () => ({ useToast: () => ({ toast: jest.fn(), dismiss: jest.fn() }) }));

const subscription = {
    status: 'success',
    account: 'jdoe',
    created_at: '2026-01-01T00:00:00Z',
    id: 's1',
    last_processed: '2026-01-03T00:00:00Z',
    lifetime: '2027-01-01T00:00:00Z',
    name: 'sub1',
    policyid: 0,
    retroactive: false,
    state: SubscriptionState.ACTIVE,
    updated_at: '2026-01-02T00:00:00Z',
    filter: '{}',
    replication_rules: '[]',
};

const originalFetch = global.fetch;

describe('DetailsSubscription page summary', () => {
    let registry: FakePageActionRegistry;
    let detach: () => void;
    let resolveFetch: (value: unknown) => void;

    beforeEach(() => {
        registry = new FakePageActionRegistry();
        detach = attachPageActionRegistry(registry);
        (global as unknown as { fetch: unknown }).fetch = jest.fn(
            () =>
                new Promise(resolve => {
                    resolveFetch = resolve;
                }),
        );
    });

    afterEach(() => {
        detach();
        (global as unknown as { fetch: unknown }).fetch = originalFetch;
    });

    it('describes the loading state, then the loaded subscription, from the same mounted page', async () => {
        const { unmount } = render(
            <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
                <DetailsSubscription account="jdoe" name="sub1" />
            </QueryClientProvider>,
        );

        expect(registry.describe()).toBe('Subscription jdoe:sub1, details are loading or failed to load.');

        await waitFor(() => expect(global.fetch).toHaveBeenCalled());
        resolveFetch({ ok: true, status: 200, json: async () => subscription });
        expect(await screen.findByTestId('subscription-meta')).toBeInTheDocument();
        await waitFor(() => expect(registry.describe()).toContain('Subscription jdoe:sub1, state A'));

        unmount();
        expect(registry.describe()).toBeUndefined();
    });
});
