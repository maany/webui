import { createFeatureTool } from '@/lib/infrastructure/assistant/feature-executor';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import type { ToolSpec } from '@/lib/core/entity/assistant/tool';
import { defineReadTool, text, withFilters, type ToolArgs } from './read-tool-helpers';
import { CreateRuleSchema, type CreateRuleInput } from '@/lib/infrastructure/api-schemas/create-rule';
import { UpdateRuleSchema, type UpdateRuleInput } from '@/lib/infrastructure/api-schemas/update-rule';
import { defineWriteTool } from '@/lib/infrastructure/assistant/write-tool';
import { summarizeCreateRule, summarizeUpdateRule } from './write-summaries';

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

// Write tools (phase 4). Hidden unless assistant.write is on; every call goes through the policy gate.

export const createRuleTool = defineWriteTool<CreateRuleInput>({
    name: 'create_rule',
    domain: 'rules',
    description:
        'Create a replication rule owned by the logged-in account. dids: the DIDs to replicate. copies: number of replicas. ' +
        'rse_expression: where to place them (check names with list_rses if unsure). lifetime_days: optional, omit for no expiry. ' +
        'ask_approval: request approval when the account lacks quota or rights. Prefer pre-filling the create-rule wizard when the user wants to review first.',
    input: CreateRuleSchema,
    risk: 'write',
    requires: { flags: ['rules.create'] },
    executor: 'feature',
    output: 'object',
    route: { path: '/api/feature/create-rule', method: 'POST' },
    describeCall: summarizeCreateRule,
});

export const updateRuleTool = defineWriteTool<UpdateRuleInput>({
    name: 'update_rule',
    domain: 'rules',
    description:
        'Change a replication rule. options.lifetime: seconds from now, null removes the expiry. options.approve: true approves, false denies a rule ' +
        'waiting for approval. options.comment and options.priority. Give at least one option. High risk: it can approve or deny rules.',
    input: UpdateRuleSchema,
    risk: 'high',
    requires: { flags: ['rules.approve'] },
    executor: 'feature',
    output: 'object',
    route: { path: '/api/feature/update-rule', method: 'PUT' },
    describeCall: summarizeUpdateRule,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const RULE_WRITE_TOOLS: RegisteredTool<any>[] = [createRuleTool, updateRuleTool];
