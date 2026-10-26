import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateRuleStageSubmission } from '@/component-library/pages/Rule/create/stage-submission/CreateRuleStageSubmission';
import { getEmptyCreateRuleParameters } from '@/lib/infrastructure/data/view-model/rule';

jest.mock('motion/react', () => {
    const React = require('react');
    const strip = ({ initial, animate, transition, ...rest }: Record<string, unknown>) => rest;
    return {
        motion: new Proxy({}, { get: (_target, tag: string) => (props: Record<string, unknown>) => React.createElement(tag, strip(props)) }),
        useReducedMotion: () => true,
    };
});
jest.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }));

const originalFetch = global.fetch;
const createRule = jest.fn(async (_url: string, _init?: RequestInit) => ({
    json: async () => ({ status: 'success', rule_ids: ['rule-id'] }),
    statusText: '',
}));

const parameters = (comments: string) => ({ ...getEmptyCreateRuleParameters(), comments });

describe('CreateRuleStageSubmission after a prefill', () => {
    beforeEach(() => {
        createRule.mockClear();
        (global as unknown as { fetch: unknown }).fetch = createRule;
    });
    afterAll(() => {
        (global as unknown as { fetch: unknown }).fetch = originalFetch;
    });

    it('submits again with new parameters instead of showing the previous result', async () => {
        const client = new QueryClient();
        const ui = (comments: string) => (
            <QueryClientProvider client={client}>
                <CreateRuleStageSubmission parameters={parameters(comments)} removeSaved={jest.fn()} />
            </QueryClientProvider>
        );

        const first = render(ui('first'));
        await waitFor(() => expect(createRule).toHaveBeenCalledTimes(1));
        await screen.findByText('Rule Created Successfully!');
        first.unmount();
        // gcTime 0 drops the query on the next timer tick, as it does between two real visits of the stage
        await new Promise(resolve => setTimeout(resolve, 0));

        render(ui('second'));
        await waitFor(() => expect(createRule).toHaveBeenCalledTimes(2));
        expect(JSON.parse(createRule.mock.calls[1][1]!.body as string).comments).toBe('second');
    });
});
