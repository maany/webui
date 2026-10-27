jest.mock('@/lib/infrastructure/hooks/useAssistantConfig', () => ({ useAssistantConfig: jest.fn() }));
jest.mock('@/lib/infrastructure/hooks/useAssistantSettings', () => ({ useAssistantSettings: jest.fn() }));
jest.mock('@/lib/infrastructure/assistant/tool-registry', () => ({ getTool: jest.fn() }));

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { z } from 'zod';
import { DEFAULT_ASSISTANT_CONFIG } from '@/lib/core/entity/assistant/assistant-config';
import type { ToolSpec } from '@/lib/core/entity/assistant/tool';
import { ToolApprovalSlot, type ToolCallPart } from '@/component-library/features/assistant/ToolApprovalSlot';
import { getTool } from '@/lib/infrastructure/assistant/tool-registry';
import { AssistantContext, type UseAssistantResult } from '@/lib/infrastructure/hooks/useAssistant';
import { useAssistantConfig } from '@/lib/infrastructure/hooks/useAssistantConfig';
import { useAssistantSettings } from '@/lib/infrastructure/hooks/useAssistantSettings';

const SUMMARY = 'Create rule: 2 copies of data18:XYZ on tier=1, lifetime 30 days';

function spec(overrides: Partial<ToolSpec<unknown>> = {}): ToolSpec<unknown> {
    return {
        name: 'create_rule',
        domain: 'rules',
        description: 'Create a rule',
        input: z.unknown(),
        risk: 'write',
        requires: { flags: ['rules.create'] },
        executor: 'feature',
        output: 'object',
        route: { path: '/api/feature/create-rule', method: 'POST' },
        describeCall: () => SUMMARY,
        ...overrides,
    };
}

const part = (status: ToolCallPart['status'] = 'awaiting-approval', args: unknown = { copies: 2 }, toolName = 'create_rule'): ToolCallPart => ({
    type: 'tool-call',
    toolCallId: 'call_1',
    toolName,
    args,
    policy: 'ask',
    status,
});

const resolveApproval = jest.fn().mockResolvedValue(undefined);
let assistant: UseAssistantResult;

const describeCall = jest.fn(() => SUMMARY);

function mockHooks({
    writePolicyCap = 'ask' as 'ask' | 'allow',
    risk = 'write' as 'write' | 'high',
    pending = true,
    configState = {} as { isLoading?: boolean; error?: Error },
    specOverrides = {} as Partial<ToolSpec<unknown>>,
    args = { copies: 2 } as unknown,
} = {}) {
    jest.mocked(getTool).mockReturnValue({ spec: spec({ risk, describeCall, ...specOverrides }), execute: jest.fn() });
    assistant = {
        pendingApprovals: pending
            ? [{ toolCallId: 'call_1', toolName: 'create_rule', args, summary: SUMMARY, risk, allowConversationScope: risk !== 'high' }]
            : [],
        resolveApproval,
    } as unknown as UseAssistantResult;
    jest.mocked(useAssistantConfig).mockReturnValue({
        config: { ...DEFAULT_ASSISTANT_CONFIG, writePolicyCap },
        isLoading: false,
        isLoaded: true,
        ...configState,
    });
    jest.mocked(useAssistantSettings).mockReturnValue({ settings: { toolPolicies: {} }, update: jest.fn() } as never);
}

function renderInPanel(ui: React.ReactElement) {
    return render(<AssistantContext.Provider value={assistant}>{ui}</AssistantContext.Provider>);
}

describe('ToolApprovalSlot', () => {
    beforeAll(() => {
        Element.prototype.scrollIntoView = jest.fn();
    });
    beforeEach(() => {
        resolveApproval.mockClear();
        describeCall.mockClear();
        jest.mocked(useAssistantConfig).mockClear();
    });

    it('renders a pending card and resolves through the chat controller', () => {
        mockHooks();
        renderInPanel(<ToolApprovalSlot part={part()} />);
        expect(screen.getByText(SUMMARY)).toBeInTheDocument();
        expect(screen.getByText('Changes to Rucio need your approval by default.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
        expect(resolveApproval).toHaveBeenCalledWith('call_1', 'approved', 'once');
    });

    it('hides "Allow for this conversation" while the operator cap is ask', () => {
        mockHooks({ writePolicyCap: 'ask' });
        renderInPanel(<ToolApprovalSlot part={part()} />);
        expect(screen.queryByRole('checkbox', { name: 'Allow for this conversation' })).not.toBeInTheDocument();
    });

    it('offers conversation scope when the cap allows it', () => {
        mockHooks({ writePolicyCap: 'allow' });
        renderInPanel(<ToolApprovalSlot part={part()} />);
        fireEvent.click(screen.getByRole('checkbox', { name: 'Allow for this conversation' }));
        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
        expect(resolveApproval).toHaveBeenCalledWith('call_1', 'approved', 'conversation');
    });

    it('never offers conversation scope for high-risk tools', () => {
        mockHooks({ writePolicyCap: 'allow', risk: 'high' });
        renderInPanel(<ToolApprovalSlot part={part()} />);
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('renders an expired call (after reload) read-only, even outside the provider', () => {
        mockHooks({ pending: false });
        render(
            <ToolApprovalSlot
                part={part('expired')}
                approval={{
                    type: 'approval',
                    toolCallId: 'call_1',
                    decision: 'expired',
                    scope: 'once',
                    approver: 'jdoe@def',
                    at: '2026-10-25T12:00:00.000Z',
                }}
            />,
        );
        expect(screen.getByText('Expired')).toBeInTheDocument();
        expect(screen.getByText(SUMMARY)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    });

    it('renders an approved call read-only while it still runs', () => {
        mockHooks({ pending: false });
        renderInPanel(
            <ToolApprovalSlot
                part={part('awaiting-approval')}
                approval={{
                    type: 'approval',
                    toolCallId: 'call_1',
                    decision: 'approved',
                    scope: 'once',
                    approver: 'jdoe@def',
                    at: '2026-10-25T12:00:00.000Z',
                }}
            />,
        );
        expect(screen.getByText('Approved')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    });

    it('says an approved call did not run when its approval could not be saved', () => {
        mockHooks({ pending: false });
        const denied: ToolCallPart = {
            ...part('denied'),
            error: { error: 'rejected_by_user', message: 'The approval could not be recorded, so the action did not run. Try again.' },
        };
        renderInPanel(
            <ToolApprovalSlot
                part={denied}
                approval={{
                    type: 'approval',
                    toolCallId: 'call_1',
                    decision: 'approved',
                    scope: 'once',
                    approver: 'jdoe@def',
                    at: '2026-10-25T12:00:00.000Z',
                }}
            />,
        );
        expect(screen.getByText('The approval could not be recorded, so the action did not run. Try again.')).toBeInTheDocument();
        expect(screen.queryByText('You approved this action.')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    });

    it('renders nothing for a tool call that never needed approval, without reading config', () => {
        mockHooks({ pending: false });
        jest.mocked(useAssistantConfig).mockClear();
        const { container } = render(<ToolApprovalSlot part={part('done')} />);
        expect(container).toBeEmptyDOMElement();
        expect(useAssistantConfig).not.toHaveBeenCalled();
    });

    it('does not render a pending card for a call that is no longer pending in the controller', () => {
        mockHooks({ pending: false });
        const { container } = renderInPanel(<ToolApprovalSlot part={part('awaiting-approval')} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing for a waiting call outside AssistantProvider', () => {
        mockHooks();
        const { container } = render(<ToolApprovalSlot part={part('awaiting-approval')} />);
        expect(container).toBeEmptyDOMElement();
    });
    it('hides conversation scope while the operator config is loading or failed to load', () => {
        mockHooks({ writePolicyCap: 'allow', configState: { isLoading: true } });
        const { unmount } = renderInPanel(<ToolApprovalSlot part={part()} />);
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
        unmount();
        mockHooks({ writePolicyCap: 'allow', configState: { error: new Error('down') } });
        renderInPanel(<ToolApprovalSlot part={part()} />);
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('does not throw on the promise returned by resolveApproval', async () => {
        mockHooks();
        resolveApproval.mockRejectedValueOnce(new Error('save failed'));
        const unhandled = jest.fn();
        process.on('unhandledRejection', unhandled);
        renderInPanel(<ToolApprovalSlot part={part()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
        await new Promise(resolve => setTimeout(resolve, 10));
        process.off('unhandledRejection', unhandled);
        expect(unhandled).not.toHaveBeenCalled();
    });

    it('never shows the identity password, pending or decided', () => {
        const args = { account: 'jdoe', identity: 'jdoe', authType: 'USERPASS', password: 's3cret-Pass' };
        mockHooks({ risk: 'high', args, specOverrides: { name: 'add_account_identity', sensitiveArgs: ['password'] } });
        const call = part('awaiting-approval', args, 'add_account_identity');
        const { unmount } = renderInPanel(<ToolApprovalSlot part={call} />);
        fireEvent.click(screen.getByRole('button', { name: 'Show arguments' }));
        expect(document.body.textContent).toContain('[hidden]');
        expect(document.body.textContent).not.toContain('s3cret');
        unmount();
        mockHooks({ pending: false, risk: 'high', args, specOverrides: { name: 'add_account_identity', sensitiveArgs: ['password'] } });
        renderInPanel(
            <ToolApprovalSlot
                part={part('expired', args, 'add_account_identity')}
                approval={{
                    type: 'approval',
                    toolCallId: 'call_1',
                    decision: 'expired',
                    scope: 'once',
                    approver: 'jdoe@def',
                    at: '2026-10-25T12:00:00.000Z',
                }}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Show arguments' }));
        expect(document.body.textContent).not.toContain('s3cret');
    });

    describe('invalid arguments marker', () => {
        const marker = { __rucio_invalid_args: { message: 'copies: Required', received: { account: 'jdoe', password: 's3cret-Pass' } } };
        const sensitive = { sensitiveArgs: ['password'] as readonly string[] };

        it('offers only Reject on a pending card and never calls describeCall', () => {
            mockHooks({ writePolicyCap: 'allow', args: marker, specOverrides: sensitive });
            renderInPanel(<ToolApprovalSlot part={part('awaiting-approval', marker)} />);
            expect(screen.getByRole('heading', { name: 'Rucio bot sent invalid arguments' })).toBeInTheDocument();
            expect(screen.getByText('copies: Required')).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
            expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'Show arguments' }));
            expect(document.body.textContent).toContain('[hidden]');
            expect(document.body.textContent).not.toContain('s3cret');
            fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
            expect(resolveApproval).toHaveBeenCalledWith('call_1', 'rejected', 'once');
            expect(describeCall).not.toHaveBeenCalled();
        });

        it('renders a decided marker call read-only without calling describeCall', () => {
            mockHooks({ pending: false, args: marker, specOverrides: sensitive });
            renderInPanel(
                <ToolApprovalSlot
                    part={part('expired', marker)}
                    approval={{
                        type: 'approval',
                        toolCallId: 'call_1',
                        decision: 'expired',
                        scope: 'once',
                        approver: 'jdoe@def',
                        at: '2026-10-25T12:00:00.000Z',
                    }}
                />,
            );
            expect(screen.getByText('Run create_rule (invalid arguments)')).toBeInTheDocument();
            expect(screen.getByText('Expired')).toBeInTheDocument();
            expect(describeCall).not.toHaveBeenCalled();
        });
    });
});
