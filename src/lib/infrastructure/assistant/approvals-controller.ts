import type { ChatMessage } from '@/lib/core/entity/assistant/conversation';
import type { AssistantEvent } from '@/lib/core/entity/assistant/events';
import { addApprovalPart } from './message-reducer';

export interface ApprovalsControllerDeps {
    /** The assistant message of the running turn, or null. */
    getMessage(): ChatMessage | null;
    setMessage(message: ChatMessage): void;
    /** Resolves the runner's interrupt; the turn is being torn down, so false never executes anything. */
    resolveRunner(toolCallId: string, approved: boolean): void;
    approver(): string;
    turnId(): string;
    emit(event: AssistantEvent): void;
}

export interface ApprovalsController {
    /** Marks every tool call still waiting for approval as expired. Returns their ids. */
    expireOpen(): string[];
}

export function createApprovalsController(deps: ApprovalsControllerDeps): ApprovalsController {
    return {
        expireOpen() {
            let message = deps.getMessage();
            if (!message) return [];
            const ids = message.parts.flatMap(part => (part.type === 'tool-call' && part.status === 'awaiting-approval' ? [part.toolCallId] : []));
            if (ids.length === 0) return [];
            const at = new Date().toISOString();
            message = {
                ...message,
                parts: message.parts.map(part =>
                    part.type === 'tool-call' && ids.includes(part.toolCallId) ? { ...part, status: 'expired' as const } : part,
                ),
            };
            for (const toolCallId of ids) {
                message = addApprovalPart(message, { toolCallId, decision: 'expired', scope: 'once', approver: deps.approver(), at });
                deps.emit({
                    type: 'tool-approval',
                    turnId: deps.turnId(),
                    toolCallId,
                    decision: 'expired',
                    scope: 'once',
                    approver: deps.approver(),
                    at: Date.now(),
                });
            }
            deps.setMessage(message);
            for (const toolCallId of ids) deps.resolveRunner(toolCallId, false);
            return ids;
        },
    };
}
