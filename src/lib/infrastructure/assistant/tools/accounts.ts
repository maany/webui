import { createFeatureTool } from '@/lib/infrastructure/assistant/feature-executor';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import type { ToolSpec } from '@/lib/core/entity/assistant/tool';
import { Role } from '@/lib/core/entity/auth-models';
import { defineReadTool, text, withFilters, type ToolArgs } from './read-tool-helpers';
import { AddAccountAttributeSchema, type AddAccountAttributeInput } from '@/lib/infrastructure/api-schemas/add-account-attribute';
import { AddAccountIdentitySchema, type AddAccountIdentityInput } from '@/lib/infrastructure/api-schemas/add-account-identity';
import { CreateAccountSchema, type CreateAccountInput } from '@/lib/infrastructure/api-schemas/create-account';
import { DeleteAccountSchema, type DeleteAccountInput } from '@/lib/infrastructure/api-schemas/delete-account';
import { DeleteAccountAttributeSchema, type DeleteAccountAttributeInput } from '@/lib/infrastructure/api-schemas/delete-account-attribute';
import { DeleteAccountIdentitySchema, type DeleteAccountIdentityInput } from '@/lib/infrastructure/api-schemas/delete-account-identity';
import { DeleteAccountLimitSchema, type DeleteAccountLimitInput } from '@/lib/infrastructure/api-schemas/delete-account-limit';
import { SetAccountLimitSchema, type SetAccountLimitInput } from '@/lib/infrastructure/api-schemas/set-account-limit';
import { UpdateAccountSchema, type UpdateAccountInput } from '@/lib/infrastructure/api-schemas/update-account';
import { UpdateAccountAttributeSchema, type UpdateAccountAttributeInput } from '@/lib/infrastructure/api-schemas/update-account-attribute';
import { defineWriteTool } from '@/lib/infrastructure/assistant/write-tool';
import {
    summarizeAddAccountAttribute,
    summarizeAddAccountIdentity,
    summarizeCreateAccount,
    summarizeDeleteAccount,
    summarizeDeleteAccountAttribute,
    summarizeDeleteAccountIdentity,
    summarizeDeleteAccountLimit,
    summarizeSetAccountLimit,
    summarizeUpdateAccount,
    summarizeUpdateAccountAttribute,
} from './write-summaries';

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

// Write tools (phase 4). All account mutations are admin only (withAdmin) and need the
// accounts.manage area flag their route needs (accounts.manage gates every area).

type AccountManageArea = 'accounts.manage.core' | 'accounts.manage.identities' | 'accounts.manage.attributes' | 'accounts.manage.quotas';

const accountWriteRequires = (area: AccountManageArea): ToolSpec['requires'] => ({ flags: [area], role: Role.ADMIN });

export const createAccountTool = defineWriteTool<CreateAccountInput>({
    name: 'create_account',
    domain: 'accounts',
    description:
        'Create a Rucio account. accountType is USER, GROUP or SERVICE. email may be null. Rucio usually restricts this to the root account.',
    input: CreateAccountSchema,
    risk: 'write',
    requires: accountWriteRequires('accounts.manage.core'),
    executor: 'feature',
    output: 'object',
    route: { path: '/api/feature/create-account', method: 'POST' },
    describeCall: summarizeCreateAccount,
});

export const updateAccountTool = defineWriteTool<UpdateAccountInput>({
    name: 'update_account',
    domain: 'accounts',
    description:
        "Change an account's email, type or status. options.status ACTIVE reactivates, SUSPENDED suspends. Deleting goes through delete_account. " +
        'High risk: suspending locks the account out and reactivating restores its access.',
    input: UpdateAccountSchema,
    risk: 'high',
    requires: accountWriteRequires('accounts.manage.core'),
    executor: 'feature',
    output: 'object',
    route: { path: '/api/feature/update-account', method: 'PUT' },
    describeCall: summarizeUpdateAccount,
});

export const deleteAccountTool = defineWriteTool<DeleteAccountInput>({
    name: 'delete_account',
    domain: 'accounts',
    description:
        'Delete an account. High risk: Rucio keeps a tombstone, so the name can never be reused. Existing sessions keep working until they expire.',
    input: DeleteAccountSchema,
    risk: 'high',
    requires: accountWriteRequires('accounts.manage.core'),
    executor: 'feature',
    output: 'object',
    route: { path: '/api/feature/delete-account', method: 'DELETE' },
    describeCall: summarizeDeleteAccount,
});

export const addAccountAttributeTool = defineWriteTool<AddAccountAttributeInput>({
    name: 'add_account_attribute',
    domain: 'accounts',
    description: 'Add a key=value attribute to an account. High risk: setting admin=True makes the account a Rucio admin.',
    input: AddAccountAttributeSchema,
    risk: 'high',
    requires: accountWriteRequires('accounts.manage.attributes'),
    executor: 'feature',
    output: 'object',
    route: { path: '/api/feature/add-account-attribute', method: 'POST' },
    describeCall: summarizeAddAccountAttribute,
});

export const updateAccountAttributeTool = defineWriteTool<UpdateAccountAttributeInput>({
    name: 'update_account_attribute',
    domain: 'accounts',
    description: 'Change the value of an existing account attribute. High risk: setting admin=True makes the account a Rucio admin.',
    input: UpdateAccountAttributeSchema,
    risk: 'high',
    requires: accountWriteRequires('accounts.manage.attributes'),
    executor: 'feature',
    output: 'object',
    route: { path: '/api/feature/update-account-attribute', method: 'PUT' },
    describeCall: summarizeUpdateAccountAttribute,
});

export const deleteAccountAttributeTool = defineWriteTool<DeleteAccountAttributeInput>({
    name: 'delete_account_attribute',
    domain: 'accounts',
    description: 'Remove an attribute from an account. High risk: removing admin takes Rucio admin rights away from the account.',
    input: DeleteAccountAttributeSchema,
    risk: 'high',
    requires: accountWriteRequires('accounts.manage.attributes'),
    executor: 'feature',
    output: 'object',
    route: { path: '/api/feature/delete-account-attribute', method: 'DELETE' },
    describeCall: summarizeDeleteAccountAttribute,
});

export const addAccountIdentityTool = defineWriteTool<AddAccountIdentityInput>({
    name: 'add_account_identity',
    domain: 'accounts',
    description:
        'Map an identity (X509 DN, OIDC subject, SSH key, user name) to an account so it can log in as that account. High risk. ' +
        'USERPASS identities need a password. Never repeat a password back to the user.',
    input: AddAccountIdentitySchema,
    risk: 'high',
    requires: accountWriteRequires('accounts.manage.identities'),
    executor: 'feature',
    output: 'object',
    route: { path: '/api/feature/add-account-identity', method: 'POST' },
    describeCall: summarizeAddAccountIdentity,
    sensitiveArgs: ['password'],
});

export const deleteAccountIdentityTool = defineWriteTool<DeleteAccountIdentityInput>({
    name: 'delete_account_identity',
    domain: 'accounts',
    description: 'Remove an identity mapping from an account. High risk: that identity can no longer log in as the account.',
    input: DeleteAccountIdentitySchema,
    risk: 'high',
    requires: accountWriteRequires('accounts.manage.identities'),
    executor: 'feature',
    output: 'object',
    route: { path: '/api/feature/delete-account-identity', method: 'DELETE' },
    describeCall: summarizeDeleteAccountIdentity,
});

export const setAccountLimitTool = defineWriteTool<SetAccountLimitInput>({
    name: 'set_account_limit',
    domain: 'accounts',
    description:
        "Set an account's storage quota in bytes (base 10) on an RSE expression. locality local applies per RSE, global across the expression. bytes -1 means unlimited.",
    input: SetAccountLimitSchema,
    risk: 'write',
    requires: accountWriteRequires('accounts.manage.quotas'),
    executor: 'feature',
    output: 'object',
    route: { path: '/api/feature/set-account-limit', method: 'PUT' },
    describeCall: summarizeSetAccountLimit,
});

export const deleteAccountLimitTool = defineWriteTool<DeleteAccountLimitInput>({
    name: 'delete_account_limit',
    domain: 'accounts',
    description: "Remove an account's local or global quota on an RSE expression.",
    input: DeleteAccountLimitSchema,
    risk: 'write',
    requires: accountWriteRequires('accounts.manage.quotas'),
    executor: 'feature',
    output: 'object',
    route: { path: '/api/feature/delete-account-limit', method: 'DELETE' },
    describeCall: summarizeDeleteAccountLimit,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ACCOUNT_WRITE_TOOLS: RegisteredTool<any>[] = [
    createAccountTool,
    updateAccountTool,
    deleteAccountTool,
    addAccountAttributeTool,
    updateAccountAttributeTool,
    deleteAccountAttributeTool,
    addAccountIdentityTool,
    deleteAccountIdentityTool,
    setAccountLimitTool,
    deleteAccountLimitTool,
];
