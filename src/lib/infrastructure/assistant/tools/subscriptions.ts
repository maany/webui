import { createFeatureTool } from '@/lib/infrastructure/assistant/feature-executor';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import type { ToolSpec } from '@/lib/core/entity/assistant/tool';
import { defineReadTool, text, type ToolArgs } from './read-tool-helpers';

export const subscriptionToolSpecs: ToolSpec<ToolArgs>[] = [
    defineReadTool({
        route: 'list-subscription',
        domain: 'subscriptions',
        output: 'rows',
        flags: ['subscriptions'],
        description:
            'List the subscriptions of your own account. `account` is required: pass your account name. Rows: id, name, account, state, filter, policyid, retroactive, lifetime, created_at, updated_at, last_processed.',
        describeCall: () => 'List your subscriptions',
    }),
    defineReadTool({
        route: 'get-subscription',
        domain: 'subscriptions',
        output: 'object',
        flags: ['subscriptions'],
        description:
            'Get one subscription by `account` and `name`, both required: state, DID filter, replication rules it creates, policy, lifetime and timestamps.',
        describeCall: args => `Get subscription ${text(args, 'name')} of ${text(args, 'account') || 'your account'}`,
    }),
    defineReadTool({
        route: 'list-subscription-rule-states',
        domain: 'subscriptions',
        output: 'rows',
        flags: ['subscriptions'],
        description:
            'Summarise the rule states of every subscription of an account (`account`, defaults to yours). Rows: name, subscriptionState, state_ok, state_replicating, state_stuck, state_suspended, state_waiting_approval, state_inject.',
        describeCall: args => `Summarise subscription rule states of ${text(args, 'account') || 'your account'}`,
    }),
];

export const subscriptionTools: RegisteredTool<ToolArgs>[] = subscriptionToolSpecs.map(spec => createFeatureTool(spec));
