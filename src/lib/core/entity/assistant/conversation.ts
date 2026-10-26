import type { PageContext } from './page-context';
import type { ToolError, ToolPolicy } from './tool';
import type { TurnUsage, UsageTotals } from './usage';
import type { DataHandleProvenance } from './data-handle';

export type ToolCallStatus = 'awaiting-approval' | 'running' | 'done' | 'error' | 'denied' | 'expired';

export type MessagePart =
    | { type: 'text'; text: string }
    | { type: 'reasoning'; text: string; durationMs?: number }
    | {
          type: 'tool-call';
          toolCallId: string;
          toolName: string;
          args: unknown;
          policy: ToolPolicy;
          status: ToolCallStatus;
          result?: unknown; // trimmed, never raw rows beyond RowsToolResult
          error?: ToolError;
          durationMs?: number;
      }
    | {
          type: 'approval';
          toolCallId: string;
          decision: 'approved' | 'rejected' | 'expired';
          scope: 'once' | 'conversation';
          approver: string; // accountKey
          at: string; // ISO
      }
    | { type: 'page-context'; context: PageContext }
    | { type: 'notice'; level: 'info' | 'warning' | 'error'; text: string };

export interface ChatMessage {
    id: string;
    conversationId: string;
    role: 'user' | 'assistant';
    parts: MessagePart[];
    usage?: TurnUsage;
    createdAt: string;
}

export interface Conversation {
    id: string;
    accountKey: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    providerId: string | 'operator';
    model: string;
    usage: UsageTotals;
    compactedSummary?: string;
    compactedUpToMessageId?: string;
    conversationAllow: string[]; // tool names approved "for this conversation"
    handles: (DataHandleProvenance & { name: string })[];
    activeTools?: string[]; // tools loaded by find_tools, oldest first
}
