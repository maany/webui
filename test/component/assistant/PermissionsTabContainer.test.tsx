jest.mock('@/lib/infrastructure/hooks/useToolVisibilityContext', () => ({ useToolVisibilityContext: jest.fn() }));
jest.mock('@/lib/infrastructure/assistant/tool-registry', () => ({ allTools: jest.fn() }));
jest.mock('@/lib/infrastructure/assistant/tools', () => ({}));

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { z } from 'zod';
import { DEFAULT_ASSISTANT_CONFIG } from '@/lib/core/entity/assistant/assistant-config';
import { Role } from '@/lib/core/entity/auth-models';
import type { AssistantSettings } from '@/lib/core/entity/assistant/settings';
import { ASSISTANT_SETTINGS_TABS } from '@/component-library/features/assistant/settings/AssistantSettingsView';
import { PermissionsTabContainer } from '@/component-library/features/assistant/settings/PermissionsTabContainer';
import { allTools } from '@/lib/infrastructure/assistant/tool-registry';
import { useToolVisibilityContext } from '@/lib/infrastructure/hooks/useToolVisibilityContext';
import { ALL_FLAGS_ON } from 'test/fixtures/assistant-write-fixtures';

const update = jest.fn();
const settings = { toolPolicies: { list_dids: 'ask' } } as unknown as AssistantSettings;

beforeEach(() => {
    update.mockClear();
    jest.mocked(allTools).mockReturnValue([
        {
            spec: {
                name: 'create_rule',
                domain: 'rules',
                description: 'Create a rule',
                input: z.unknown(),
                risk: 'write',
                requires: { flags: ['rules.create'] },
                executor: 'feature',
                output: 'object',
                route: { path: '/api/feature/create-rule', method: 'POST' },
                describeCall: () => 'Create rule',
            },
            execute: jest.fn(),
        },
    ]);
    jest.mocked(useToolVisibilityContext).mockReturnValue({ flags: ALL_FLAGS_ON, role: Role.USER, permissionsReady: true });
});

describe('PermissionsTabContainer', () => {
    it('saves choices through the settings view onUpdate', () => {
        render(<PermissionsTabContainer config={DEFAULT_ASSISTANT_CONFIG} settings={settings} onUpdate={update} />);
        fireEvent.click(within(screen.getByRole('group', { name: 'Policy for create_rule' })).getByRole('radio', { name: 'Deny' }));
        expect(update).toHaveBeenCalledTimes(1);
        const patch = update.mock.calls[0][0] as (s: AssistantSettings) => AssistantSettings;
        expect(patch(settings).toolPolicies).toEqual({ list_dids: 'ask', create_rule: 'deny' });
    });

    it('explains that writes stay blocked when the limits fail to load', () => {
        render(<PermissionsTabContainer config={DEFAULT_ASSISTANT_CONFIG} configError={new Error('500')} settings={settings} onUpdate={update} />);
        expect(screen.getByText('Could not load the operator limits. Write tools stay blocked until they load.')).toBeInTheDocument();
        expect(screen.queryByRole('group')).not.toBeInTheDocument();
    });

    it('is the settings tab right after Providers (spec 6.4 order)', () => {
        expect(ASSISTANT_SETTINGS_TABS.map(tab => tab.name).slice(0, 2)).toEqual(['Providers', 'Permissions']);
    });

    it('shows no policy controls while the limits are in error', () => {
        render(<PermissionsTabContainer config={DEFAULT_ASSISTANT_CONFIG} configError={new Error('500')} settings={settings} onUpdate={update} />);
        expect(screen.queryByRole('button', { name: 'Reset to defaults' })).not.toBeInTheDocument();
    });
});
