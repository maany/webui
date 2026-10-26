import { createFeatureTool } from '@/lib/infrastructure/assistant/feature-executor';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import type { ToolSpec } from '@/lib/core/entity/assistant/tool';
import { Role } from '@/lib/core/entity/auth-models';
import { defineReadTool, text, withFilters, type ToolArgs } from './read-tool-helpers';

const accountOf = (args: ToolArgs): string => text(args, 'account') || 'your account';

export const accountToolSpecs: ToolSpec<ToolArgs>[] = [
    defineReadTool({
        route: 'get-site-header',
        domain: 'accounts',
        output: 'object',
        flags: [],
        description:
            'Get the account you are acting as (account, identity, VO, role) and the other accounts you can switch to. Use it to answer who am I.',
        describeCall: () => 'Get the active account',
    }),
    defineReadTool({
        route: 'get-account-info',
        domain: 'accounts',
        output: 'object',
        flags: [],
        description:
            'Get the details of an account: type (USER, GROUP, SERVICE), status, email and created, updated, suspended and deleted dates. `account` is optional and defaults to your own; only admins can read other accounts.',
        describeCall: args => `Get account ${accountOf(args)}`,
    }),
    defineReadTool({
        route: 'get-account-quotas',
        domain: 'accounts',
        output: 'object',
        flags: ['accounts'],
        description:
            'Get the quotas of an account (`account` is required; pass your own account name, which get_site_header returns): local limits per RSE, global limits per RSE expression and the current usage against each. Admins can read any account, others only their own.',
        describeCall: args => `Get quotas of ${accountOf(args)}`,
    }),
    defineReadTool({
        route: 'list-account-attributes',
        domain: 'accounts',
        output: 'object',
        flags: ['accounts'],
        description:
            'List the attributes of an account (`account` is required; pass your own account name, which get_site_header returns) as key and value, for example admin=True. Admins can read any account, others only their own.',
        describeCall: args => `List attributes of ${accountOf(args)}`,
    }),
    defineReadTool({
        route: 'list-account-identities',
        domain: 'accounts',
        output: 'object',
        flags: ['accounts'],
        description:
            'List the identities mapped to an account (`account` is required; pass your own account name, which get_site_header returns). Identities are x509 DNs, OIDC subjects, usernames and SSH keys, each with type and email. Admins can read any account, others only their own.',
        describeCall: args => `List identities of ${accountOf(args)}`,
    }),
    defineReadTool({
        route: 'list-accounts',
        domain: 'accounts',
        output: 'rows',
        flags: ['accounts'],
        role: Role.ADMIN,
        description:
            'Admins only. List accounts, optionally filtered by `account` name pattern (wildcards allowed), `accountType` (USER, GROUP, SERVICE) or `identity`. Rows: account, accountType, email.',
        describeCall: args => withFilters('List accounts', args, ['account', 'accountType', 'identity']),
    }),
    defineReadTool({
        route: 'list-account-rse-usage',
        domain: 'accounts',
        output: 'rows',
        flags: [],
        description:
            'List the storage your own account uses per RSE with its limits. Rows: rse_id, rse, account, files, used_bytes, bytes_limit (-1 means no limit).',
        describeCall: () => 'List your usage per RSE',
    }),
    defineReadTool({
        route: 'list-account-rse-quotas',
        domain: 'accounts',
        output: 'rows',
        method: 'POST',
        flags: [],
        description:
            'For a set of DIDs (`requestedDIDs`, each with scope and name) and an optional `rseExpression`, list each matching RSE with your quota and whether the DIDs would fit. Rows: rse, rse_id, used_bytes, bytes_limit, bytes_remaining, total_expected_usage, has_quota. Use it before creating a rule.',
        describeCall: args => {
            const dids = Array.isArray(args.requestedDIDs) ? args.requestedDIDs.length : 0;
            const expression = text(args, 'rseExpression');
            return `Check your quota for ${dids} DID${dids === 1 ? '' : 's'}${expression ? ` on ${expression}` : ''}`;
        },
    }),
];

export const accountTools: RegisteredTool<ToolArgs>[] = accountToolSpecs.map(spec => createFeatureTool(spec));
