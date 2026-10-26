'use client';

import type { MessagePart } from '@/lib/core/entity/assistant/conversation';

export type ToolCallPart = Extract<MessagePart, { type: 'tool-call' }>;
export type ApprovalPart = Extract<MessagePart, { type: 'approval' }>;

export interface ToolApprovalSlotProps {
    part: ToolCallPart;
    approval?: ApprovalPart;
}

/**
 * Where the approval card of a tool call goes, outside the collapsed activity
 * timeline so it is never hidden. Renders nothing until phase 4 adds the card.
 */
export function ToolApprovalSlot(_props: ToolApprovalSlotProps) {
    return null;
}
