import type { ChatMessage, MessagePart, ToolCallStatus } from '@/lib/core/entity/assistant/conversation';
import type { ToolError } from '@/lib/core/entity/assistant/tool';
import type { RunnerUpdate } from './tanstack-agent-runner';

type ToolCallPart = Extract<MessagePart, { type: 'tool-call' }>;

/** Largest serialized tool result kept in a stored message. */
export const MAX_STORED_RESULT_CHARS = 20_000;

export function createId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

let lastTimestamp = 0;

/** ISO timestamp that strictly increases within this page, so message order survives sorting by createdAt. */
export function monotonicIso(now: number = Date.now()): string {
    lastTimestamp = Math.max(now, lastTimestamp + 1);
    return new Date(lastTimestamp).toISOString();
}

export function createAssistantMessage(conversationId: string): ChatMessage {
    return { id: createId(), conversationId, role: 'assistant', parts: [], createdAt: monotonicIso() };
}

/** Hard ceiling: even an exempted data result above this is trimmed. */
const MAX_BOUNDED_RESULT_CHARS = 64_000;

/** Rows-tool and SQL results are already bounded (3 sample rows, maxRows) and carry handle names the transcript needs. */
function isBoundedDataResult(result: unknown): boolean {
    if (typeof result !== 'object' || result === null || Array.isArray(result)) return false;
    const r = result as Record<string, unknown>;
    const isRows = typeof r.handle === 'string' && typeof r.rowCount === 'number' && Array.isArray(r.columns) && Array.isArray(r.sample);
    const isSql = Array.isArray(r.columns) && Array.isArray(r.rows) && typeof r.totalRows === 'number';
    if (!isRows && !isSql) return false;
    try {
        return (JSON.stringify(result) ?? '').length <= MAX_BOUNDED_RESULT_CHARS;
    } catch {
        return false;
    }
}

/** Keeps stored results small; large results become a preview string. */
export function trimToolResult(result: unknown, maxChars: number = MAX_STORED_RESULT_CHARS): unknown {
    let serialized: string;
    try {
        serialized = JSON.stringify(result) ?? 'null';
    } catch {
        return { preview: '[unserializable result]', trimmed: true };
    }
    if (serialized.length <= maxChars) return result;
    return { preview: serialized.slice(0, maxChars), trimmed: true };
}

export function statusForToolError(error: ToolError | undefined): ToolCallStatus {
    if (!error) return 'done';
    if (error.error === 'denied_by_policy' || error.error === 'rejected_by_user') return 'denied';
    return 'error';
}

function updateToolPart(message: ChatMessage, toolCallId: string, patch: (part: ToolCallPart) => ToolCallPart): ChatMessage {
    let changed = false;
    const parts = message.parts.map(part => {
        if (part.type !== 'tool-call' || part.toolCallId !== toolCallId) return part;
        changed = true;
        return patch(part);
    });
    return changed ? { ...message, parts } : message;
}

/** Applies one runner update to the assistant message being streamed. Pure. */
export function applyRunnerUpdate(message: ChatMessage, update: RunnerUpdate): ChatMessage {
    switch (update.type) {
        case 'text-delta':
        case 'reasoning-delta': {
            const kind = update.type === 'text-delta' ? 'text' : 'reasoning';
            const last = message.parts[message.parts.length - 1];
            if (last && last.type === kind) {
                const merged = { ...last, text: last.text + update.text };
                return { ...message, parts: [...message.parts.slice(0, -1), merged] };
            }
            const part: MessagePart = kind === 'text' ? { type: 'text', text: update.text } : { type: 'reasoning', text: update.text };
            return { ...message, parts: [...message.parts, part] };
        }
        case 'tool-call': {
            const part: ToolCallPart = {
                type: 'tool-call',
                toolCallId: update.toolCallId,
                toolName: update.toolName,
                args: update.args,
                policy: update.policy,
                status: 'running',
            };
            if (message.parts.some(existing => existing.type === 'tool-call' && existing.toolCallId === update.toolCallId)) {
                return updateToolPart(message, update.toolCallId, existing => ({
                    ...existing,
                    toolName: update.toolName,
                    args: update.args,
                    policy: update.policy,
                }));
            }
            return { ...message, parts: [...message.parts, part] };
        }
        case 'approval-required':
            return updateToolPart(message, update.toolCallId, part => (part.status === 'running' ? { ...part, status: 'awaiting-approval' } : part));
        case 'tool-result':
            return updateToolPart(message, update.toolCallId, part => ({
                ...part,
                status: statusForToolError(update.error),
                result: update.error ? undefined : isBoundedDataResult(update.result) ? update.result : trimToolResult(update.result),
                ...(update.error ? { error: update.error } : {}),
                durationMs: update.durationMs,
            }));
        case 'usage':
            return message;
        case 'finished':
            return finalizeAssistantMessage(message, update.status, update.error);
    }
}

/** Notice text added when the step limit ends a turn; the panel shows Continue after it. */
export const STEP_LIMIT_NOTICE = 'Step limit reached. Press Continue to let Rucio bot keep working.';

const APPROVED_OUTCOME_UNKNOWN: ToolError = {
    error: 'aborted',
    message: 'Approved, but the page closed before the result arrived. The change may have been applied, so check its state before retrying.',
};

const ABORTED: ToolError = { error: 'aborted', message: 'The turn was stopped before this tool finished.' };

/** Closes open tool calls and adds the end-of-turn notice. */
export function finalizeAssistantMessage(
    message: ChatMessage,
    status: 'completed' | 'stopped' | 'error' | 'step-limit',
    error?: string,
): ChatMessage {
    const wasApproved = (toolCallId: string) =>
        message.parts.some(part => part.type === 'approval' && part.toolCallId === toolCallId && part.decision === 'approved');
    const parts: MessagePart[] = message.parts.map(part =>
        part.type === 'tool-call' && (part.status === 'running' || part.status === 'awaiting-approval')
            ? // An approved write still in flight may have landed, so it never reads as plainly stopped.
              { ...part, status: 'error', error: part.status === 'running' && wasApproved(part.toolCallId) ? APPROVED_OUTCOME_UNKNOWN : ABORTED }
            : part,
    );
    if (status === 'step-limit') parts.push({ type: 'notice', level: 'warning', text: STEP_LIMIT_NOTICE });
    if (status === 'stopped') parts.push({ type: 'notice', level: 'info', text: 'Stopped.' });
    if (status === 'error') parts.push({ type: 'notice', level: 'error', text: error ?? 'Something went wrong.' });
    return { ...message, parts };
}

/** Sets the duration of the last reasoning part. */
export function closeReasoning(message: ChatMessage, durationMs: number): ChatMessage {
    for (let i = message.parts.length - 1; i >= 0; i--) {
        const part = message.parts[i];
        if (part.type === 'reasoning') {
            if (part.durationMs !== undefined) return message;
            const parts = [...message.parts];
            parts[i] = { ...part, durationMs };
            return { ...message, parts };
        }
    }
    return message;
}

/** Records an approval decision next to its tool call. */
export function addApprovalPart(
    message: ChatMessage,
    approval: { toolCallId: string; decision: 'approved' | 'rejected' | 'expired'; scope: 'once' | 'conversation'; approver: string; at: string },
): ChatMessage {
    return { ...message, parts: [...message.parts, { type: 'approval', ...approval }] };
}

/**
 * Used when a stored conversation is reopened: a tool call that was still waiting for approval becomes expired
 * (without a second approval part when it already has one), a running one becomes aborted, and a running one the
 * user had approved reports that its outcome is unknown. Nothing is ever replayed.
 */
export function expireStaleParts(messages: ChatMessage[], approver: string, at: string): ChatMessage[] {
    return messages.map(message => {
        if (message.role !== 'assistant') return message;
        let changed = false;
        const extra: MessagePart[] = [];
        const approvalFor = (toolCallId: string) => message.parts.find(part => part.type === 'approval' && part.toolCallId === toolCallId);
        const parts = message.parts.map(part => {
            if (part.type !== 'tool-call') return part;
            if (part.status === 'awaiting-approval') {
                changed = true;
                if (!approvalFor(part.toolCallId)) {
                    extra.push({ type: 'approval', toolCallId: part.toolCallId, decision: 'expired', scope: 'once', approver, at });
                }
                return { ...part, status: 'expired' as const };
            }
            if (part.status === 'running') {
                changed = true;
                const approval = approvalFor(part.toolCallId);
                const approved = approval !== undefined && approval.type === 'approval' && approval.decision === 'approved';
                return { ...part, status: 'error' as const, error: approved ? APPROVED_OUTCOME_UNKNOWN : ABORTED };
            }
            return part;
        });
        return changed ? { ...message, parts: [...parts, ...extra] } : message;
    });
}
