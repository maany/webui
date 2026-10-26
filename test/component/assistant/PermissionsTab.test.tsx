import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Role } from '@/lib/core/entity/auth-models';
import type { ToolVisibilityContext } from '@/lib/core/services/assistant-policy';
import { PermissionsTab, type PermissionToolInfo, type PermissionsTabProps } from '@/component-library/features/assistant/settings/PermissionsTab';
import { axe } from 'jest-axe';
import { ALL_FLAGS_ON, flagsWithout } from 'test/fixtures/assistant-write-fixtures';

const EM_DASH = String.fromCharCode(0x2014);

const TOOLS: PermissionToolInfo[] = [
    { name: 'list_rules', domain: 'rules', description: 'List rules', risk: 'read', requires: { flags: ['rules'] } },
    { name: 'create_rule', domain: 'rules', description: 'Create a rule', risk: 'write', requires: { flags: ['rules.create'] } },
    { name: 'update_rule', domain: 'rules', description: 'Update a rule', risk: 'write', requires: { flags: ['rules.approve'] } },
    { name: 'list_dids', domain: 'dids', description: 'List DIDs', risk: 'read', requires: { flags: [] } },
    { name: 'list_accounts', domain: 'accounts', description: 'List accounts', risk: 'read', requires: { flags: ['accounts'] } },
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
        description: 'Declare bad replicas',
        risk: 'high',
        requires: { flags: ['assistant.bad_replicas'] },
    },
];

const admin: ToolVisibilityContext = { flags: ALL_FLAGS_ON, role: Role.ADMIN, permissionsReady: true };

function renderTab(props: Partial<PermissionsTabProps> = {}) {
    const onChange = jest.fn();
    render(
        <PermissionsTab
            tools={TOOLS}
            visibility={admin}
            config={{ writePolicyCap: 'ask', highRiskPolicyCap: 'ask' }}
            prefs={{}}
            onChange={onChange}
            {...props}
        />,
    );
    return { onChange };
}

const toolGroup = (name: string) => within(screen.getByRole('group', { name: `Policy for ${name}` }));

describe('PermissionsTab', () => {
    it('groups tools by domain in the documented order', () => {
        renderTab();
        expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['DIDs', 'Rules', 'Accounts', 'Replicas']);
        expect(within(screen.getByRole('region', { name: 'Rules' })).getByText('create_rule')).toBeInTheDocument();
    });

    it('disables options above the operator cap with an Operator limit label', () => {
        renderTab();
        const allow = toolGroup('create_rule').getByRole('radio', { name: 'Allow (Operator limit)' });
        expect(allow).toBeDisabled();
        expect(allow.closest('label')).toHaveAttribute('title', 'Operator limit');
        expect(toolGroup('create_rule').getByRole('radio', { name: 'Ask' })).toBeChecked();
        expect(toolGroup('create_rule').getByRole('radio', { name: 'Deny' })).toBeEnabled();
        expect(toolGroup('list_rules').getByRole('radio', { name: 'Allow' })).toBeEnabled();
        expect(toolGroup('list_rules').getByRole('radio', { name: 'Allow' })).toBeChecked();
    });

    it('never offers allow for high-risk tools, even when the caps allow writes', () => {
        renderTab({ config: { writePolicyCap: 'allow', highRiskPolicyCap: 'ask' } });
        expect(toolGroup('delete_account').queryByRole('radio', { name: /Allow/ })).not.toBeInTheDocument();
        expect(toolGroup('delete_account').getAllByRole('radio')).toHaveLength(2);
        expect(toolGroup('create_rule').getByRole('radio', { name: 'Allow' })).toBeEnabled();
    });

    it('shows the clamped choice when a saved preference is above the cap', () => {
        renderTab({ prefs: { create_rule: 'allow', delete_account: 'allow' } });
        expect(toolGroup('create_rule').getByRole('radio', { name: 'Ask' })).toBeChecked();
        expect(toolGroup('delete_account').getByRole('radio', { name: 'Ask' })).toBeChecked();
    });

    it('saves a per-tool choice', () => {
        const { onChange } = renderTab({ prefs: { list_dids: 'ask' } });
        fireEvent.click(toolGroup('create_rule').getByRole('radio', { name: 'Deny' }));
        expect(onChange).toHaveBeenCalledWith({ list_dids: 'ask', create_rule: 'deny' });
    });

    it('a group choice replaces the per-tool choices in that domain', () => {
        const { onChange } = renderTab({ prefs: { create_rule: 'deny', list_rules: 'ask', list_dids: 'ask' } });
        const group = within(screen.getByRole('group', { name: 'Policy for all Rules tools' }));
        fireEvent.click(group.getByRole('radio', { name: 'Ask' }));
        expect(onChange).toHaveBeenCalledWith({ list_dids: 'ask', 'group:rules': 'ask' });
    });

    it('lists hidden tools with the reason', () => {
        renderTab({ visibility: { flags: flagsWithout('assistant.bad_replicas'), role: Role.USER, permissionsReady: true } });
        const hidden = within(screen.getByRole('region', { name: 'Hidden tools' }));
        expect(hidden.getByText('delete_account').closest('li')).toHaveTextContent('Admin only');
        expect(hidden.getByText('declare_bad_replicas').closest('li')).toHaveTextContent('Feature off');
        expect(screen.queryByRole('group', { name: 'Policy for delete_account' })).not.toBeInTheDocument();
    });

    it('explains when writes are off', () => {
        renderTab({ visibility: { flags: flagsWithout('assistant.write'), role: Role.ADMIN, permissionsReady: true } });
        expect(
            within(screen.getByRole('region', { name: 'Hidden tools' }))
                .getByText('create_rule')
                .closest('li'),
        ).toHaveTextContent('Write tools are off');
    });

    it('marks every tool as checking permissions until permix is ready', () => {
        renderTab({ visibility: { ...admin, permissionsReady: false } });
        expect(within(screen.getByRole('region', { name: 'Hidden tools' })).getAllByText('Checking your permissions')).toHaveLength(TOOLS.length);
    });

    it('resets to defaults', () => {
        const { onChange } = renderTab({ prefs: { create_rule: 'deny' } });
        fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
        expect(onChange).toHaveBeenCalledWith({});
    });

    it('shows the operator limits and has no em dash', () => {
        renderTab({ config: { writePolicyCap: 'deny', highRiskPolicyCap: 'deny' } });
        expect(screen.getByText('Operator limit: writes Deny, high-risk actions Deny.')).toBeInTheDocument();
        expect(toolGroup('create_rule').getByRole('radio', { name: 'Ask (Operator limit)' })).toBeDisabled();
        expect(document.body.textContent).not.toContain(EM_DASH);
    });

    it('renders the clamped value for a mixed group and never allows high-risk tools through a group choice', () => {
        renderTab({ config: { writePolicyCap: 'allow', highRiskPolicyCap: 'ask' }, prefs: { 'group:accounts': 'allow', 'group:rules': 'allow' } });
        expect(toolGroup('list_accounts').getByRole('radio', { name: 'Allow' })).toBeChecked();
        expect(toolGroup('delete_account').getByRole('radio', { name: 'Ask' })).toBeChecked();
        expect(toolGroup('delete_account').queryByRole('radio', { name: /Allow/ })).not.toBeInTheDocument();
        expect(toolGroup('create_rule').getByRole('radio', { name: 'Allow' })).toBeChecked();
    });

    it('offers no allow in the group control of a domain with only high-risk tools', () => {
        renderTab({ config: { writePolicyCap: 'allow', highRiskPolicyCap: 'ask' }, prefs: { 'group:replicas': 'allow' } });
        const group = within(screen.getByRole('group', { name: 'Policy for all Replicas tools' }));
        expect(group.queryByRole('radio', { name: /Allow/ })).not.toBeInTheDocument();
        expect(group.getByRole('radio', { name: 'Ask' })).toBeChecked();
        expect(toolGroup('declare_bad_replicas').getByRole('radio', { name: 'Ask' })).toBeChecked();
    });

    it('has no accessibility violations', async () => {
        const { container } = render(
            <PermissionsTab
                tools={TOOLS}
                visibility={{ ...admin, role: Role.USER }}
                config={{ writePolicyCap: 'ask', highRiskPolicyCap: 'ask' }}
                prefs={{}}
                onChange={jest.fn()}
            />,
        );
        expect(await axe(container)).toHaveNoViolations();
    });
});
