import { createFeatureTool } from '@/lib/infrastructure/assistant/feature-executor';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import type { ToolSpec } from '@/lib/core/entity/assistant/tool';
import { defineReadTool, text, withFilters, type ToolArgs } from './read-tool-helpers';

export const ruleToolSpecs: ToolSpec<ToolArgs>[] = [
    defineReadTool({
        route: 'list-rules',
        domain: 'rules',
        output: 'rows',
        flags: ['rules'],
        description:
            'List replication rules. All filters are optional: account (defaults to your own account), scope, name, state (OK, Replicating, Stuck, Suspended, Waiting_Approval, Inject), activity, updated_after and updated_before (ISO date-times). Rows: id, scope, name, account, rse_expression, created_at, remaining_lifetime (seconds), state, locks_ok_cnt, locks_replicating_cnt, locks_stuck_cnt.',
        describeCall: args => withFilters('List rules', args, ['state', 'account', 'scope', 'name', 'activity']),
    }),
    defineReadTool({
        route: 'get-rule',
        domain: 'rules',
        output: 'object',
        flags: ['rules'],
        description:
            'Get one replication rule by `id`: DID, account, RSE expression, state, copies, lock counts (ok, replicating, stuck), activity, grouping, priority, expiry, locked flag and the last error.',
        describeCall: args => `Get rule ${text(args, 'id')}`,
    }),
    defineReadTool({
        route: 'list-rule-replica-lock-states',
        domain: 'rules',
        output: 'rows',
        flags: ['rules'],
        description:
            'List the replica locks of one rule (`id`). Rows: scope, name, rse, state (O ok, R replicating, S stuck, U unknown), ddm_link, fts_link. Use it to find which files and RSEs keep a rule stuck.',
        describeCall: args => `List replica locks of rule ${text(args, 'id')}`,
    }),
    defineReadTool({
        route: 'list-rules-pending-approval',
        domain: 'rules',
        output: 'rows',
        flags: ['rules.approve'],
        description:
            'List rules waiting for approval, with DID details. Optional filters: account, scope, name, activity, updated_after, updated_before. Use it to review requests before approving or denying them.',
        describeCall: args => withFilters('List rules pending approval', args, ['account', 'scope', 'name', 'activity']),
    }),
];

export const ruleTools: RegisteredTool<ToolArgs>[] = ruleToolSpecs.map(spec => createFeatureTool(spec));
