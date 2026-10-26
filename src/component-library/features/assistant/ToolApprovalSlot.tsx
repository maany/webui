'use client';

import * as React from 'react';
import type { MessagePart } from '@/lib/core/entity/assistant/conversation';
import { describePolicyReason } from '@/lib/infrastructure/assistant/policy-reason';
import { isInvalidArgsMarker } from '@/lib/infrastructure/assistant/tanstack-tools';
import { getTool } from '@/lib/infrastructure/assistant/tool-registry';
import { AssistantContext } from '@/lib/infrastructure/hooks/useAssistant';
import { useAssistantConfig } from '@/lib/infrastructure/hooks/useAssistantConfig';
import { useAssistantSettings } from '@/lib/infrastructure/hooks/useAssistantSettings';
import { ApprovalCard, type ApprovalCardProps } from './ApprovalCard';

export type ToolCallPart = Extract<MessagePart, { type: 'tool-call' }>;
export type ApprovalPart = Extract<MessagePart, { type: 'approval' }>;

export interface ToolApprovalSlotProps {
    part: ToolCallPart;
    approval?: ApprovalPart;
}

/** describeCall never sees an invalid-args marker: the model's bad arguments are shown as received. */
function summaryFor(part: ToolCallPart): string {
    if (isInvalidArgsMarker(part.args)) return `Run ${part.toolName} (invalid arguments)`;
    const spec = getTool(part.toolName)?.spec;
    if (!spec) return part.toolName;
    try {
        return spec.describeCall(part.args);
    } catch {
        return part.toolName;
    }
}

/** What the card shows as arguments, and the validation message when the model sent invalid ones. */
function argsView(part: ToolCallPart): Pick<ApprovalCardProps, 'args' | 'invalidArgsMessage'> {
    if (!isInvalidArgsMarker(part.args)) return { args: part.args };
    const { message, received } = part.args.__rucio_invalid_args;
    return { args: received, invalidArgsMessage: message };
}

/** The live card. Only mounted for a waiting call, so other tool calls never read config or settings. */
function PendingApprovalCard({ part }: { part: ToolCallPart }) {
    const assistant = React.useContext(AssistantContext);
    const { config, isLoading, error } = useAssistantConfig();
    const { settings } = useAssistantSettings();
    const pending = assistant?.pendingApprovals.find(item => item.toolCallId === part.toolCallId);
    if (!assistant || !pending) return null;

    const spec = getTool(part.toolName)?.spec;
    const view = argsView(part);
    const invalid = view.invalidArgsMessage !== undefined;
    const configLoaded = !isLoading && !error;
    return (
        <ApprovalCard
            toolName={part.toolName}
            summary={pending.summary}
            risk={pending.risk}
            {...view}
            policyReason={spec && !invalid ? describePolicyReason(spec, settings.toolPolicies, config) : undefined}
            sensitiveArgs={spec?.sensitiveArgs}
            allowConversationScope={
                !invalid && configLoaded && pending.allowConversationScope && pending.risk !== 'high' && config.writePolicyCap === 'allow'
            }
            // The controller fails closed on its own; a rejection here must not become an unhandled one.
            onResolve={(choice, scope) => void Promise.resolve(assistant.resolveApproval(part.toolCallId, choice, scope)).catch(() => undefined)}
        />
    );
}

/**
 * The approval card for one tool call, rendered by AssistantMessage outside the collapsed activity line.
 * Decided or expired calls get a read-only card; a waiting call gets the live card only while the chat
 * controller still lists it as pending; every other tool call renders nothing.
 */
export function ToolApprovalSlot({ part, approval }: ToolApprovalSlotProps) {
    const decision = approval?.decision ?? (part.status === 'expired' ? 'expired' : undefined);
    if (decision) {
        const spec = getTool(part.toolName)?.spec;
        return (
            <ApprovalCard
                toolName={part.toolName}
                summary={summaryFor(part)}
                risk={spec?.risk ?? 'high'}
                {...argsView(part)}
                sensitiveArgs={spec?.sensitiveArgs}
                allowConversationScope={false}
                decision={decision}
            />
        );
    }
    if (part.status !== 'awaiting-approval') return null;
    return <PendingApprovalCard part={part} />;
}
