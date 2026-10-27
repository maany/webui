import type { Meta, StoryObj } from '@storybook/nextjs';
import { useState } from 'react';
import { FEATURE_REGISTRY, type FeatureFlagMap, type FeatureKey } from '@/lib/core/entity/feature-config';
import { Role } from '@/lib/core/entity/auth-models';
import type { ToolPolicyPrefs } from '@/lib/core/entity/assistant/tool';
import { PermissionsTab, type PermissionToolInfo, type PermissionsTabProps } from './PermissionsTab';

const flags = (off: FeatureKey[] = []): FeatureFlagMap =>
    Object.fromEntries((Object.keys(FEATURE_REGISTRY) as FeatureKey[]).map(key => [key, !off.includes(key)])) as FeatureFlagMap;

const TOOLS: PermissionToolInfo[] = [
    { name: 'list_dids', domain: 'dids', description: 'List DIDs matching a pattern', risk: 'read', requires: { flags: [] } },
    { name: 'add_did', domain: 'dids', description: 'Create a dataset or container', risk: 'write', requires: { flags: ['dids.mutate'] } },
    { name: 'list_rules', domain: 'rules', description: 'List replication rules', risk: 'read', requires: { flags: ['rules'] } },
    { name: 'create_rule', domain: 'rules', description: 'Create a replication rule', risk: 'write', requires: { flags: ['rules.create'] } },
    { name: 'update_rule', domain: 'rules', description: 'Change, approve or deny a rule', risk: 'write', requires: { flags: ['rules.approve'] } },
    { name: 'list_accounts', domain: 'accounts', description: 'List accounts', risk: 'read', requires: { flags: ['accounts'], role: Role.ADMIN } },
    {
        name: 'delete_account',
        domain: 'accounts',
        description: 'Delete an account',
        risk: 'high',
        requires: { flags: ['accounts.manage'], role: Role.ADMIN },
    },
    {
        name: 'declare_bad_replicas',
        domain: 'replicas',
        description: 'Declare replicas bad',
        risk: 'high',
        requires: { flags: ['assistant.bad_replicas'] },
    },
];

const Stateful = (props: Omit<PermissionsTabProps, 'prefs' | 'onChange'> & { initialPrefs?: ToolPolicyPrefs }) => {
    const [prefs, setPrefs] = useState<ToolPolicyPrefs>(props.initialPrefs ?? {});
    return <PermissionsTab {...props} prefs={prefs} onChange={setPrefs} />;
};

const meta: Meta<typeof Stateful> = {
    title: 'Features/Assistant/Settings/PermissionsTab',
    component: Stateful,
    parameters: { layout: 'padded' },
    tags: ['autodocs'],
    args: {
        tools: TOOLS,
        visibility: { flags: flags(), role: Role.ADMIN, permissionsReady: true },
        config: { writePolicyCap: 'ask', highRiskPolicyCap: 'ask' },
    },
};

export default meta;
type Story = StoryObj<typeof Stateful>;

export const Default: Story = {};

export const OperatorAllowsWrites: Story = { args: { config: { writePolicyCap: 'allow', highRiskPolicyCap: 'ask' } } };

export const OperatorDeniesWrites: Story = { args: { config: { writePolicyCap: 'deny', highRiskPolicyCap: 'deny' } } };

export const NonAdminWithBadReplicasOff: Story = {
    args: { visibility: { flags: flags(['assistant.bad_replicas']), role: Role.USER, permissionsReady: true } },
};

export const WritesOff: Story = { args: { visibility: { flags: flags(['assistant.write']), role: Role.ADMIN, permissionsReady: true } } };

export const Mobile: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };
