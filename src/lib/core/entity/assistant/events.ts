import type { ToolError, ToolPolicy } from './tool';
import type { TurnUsage } from './usage';

export type AssistantEvent =
    | {
          type: 'turn-started';
          conversationId: string;
          turnId: string;
          providerKind: string;
          model: string;
          at: number;
          userText?: string;
          /** `${account}@${vo}` the turn runs as; telemetry binds the turn's spans to it. */
          accountKey?: string;
      }
    | { type: 'llm-call-finished'; turnId: string; usage: TurnUsage; finishReason?: string; at: number; outputText?: string }
    | { type: 'tool-call-started'; turnId: string; toolCallId: string; toolName: string; args: unknown; policy: ToolPolicy; at: number }
    | {
          type: 'tool-approval';
          turnId: string;
          toolCallId: string;
          decision: 'approved' | 'rejected' | 'expired';
          scope: 'once' | 'conversation';
          approver: string;
          at: number;
      }
    | { type: 'tool-call-finished'; turnId: string; toolCallId: string; durationMs: number; resultSummary?: string; error?: ToolError; at: number }
    | { type: 'sql-executed'; turnId: string; toolCallId: string; sql: string; totalRows: number; durationMs: number; at: number }
    | { type: 'skill-activated'; turnId: string; name: string; source: string; at: number }
    | { type: 'compaction'; conversationId: string; upToMessageId: string; at: number }
    | {
          type: 'turn-finished';
          turnId: string;
          status: 'completed' | 'stopped' | 'error' | 'step-limit';
          usage: TurnUsage;
          error?: string;
          at: number;
      };

export type AssistantEventListener = (event: AssistantEvent) => void;
