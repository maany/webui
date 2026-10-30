import type { ChatMessage } from '@/lib/core/entity/assistant/conversation';
import type { DataHandleProvenance } from '@/lib/core/entity/assistant/data-handle';
import { RUN_SQL_TOOL_NAME } from '@/lib/core/entity/assistant/tool';

/** The shape Conversation.handles stores: provenance plus the handle (table) name. */
export type HandleRecord = DataHandleProvenance & { name: string };

export const REFRESH_HANDLE_TOOL = 'refresh_handle';
export const SESSION_ERROR_CODES = ['session_expired', 'unauthorized'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Rebuilds handle provenance from the transcript: the latest successful call that produced each handle name wins. */
export function deriveHandleRecords(messages: ChatMessage[]): HandleRecord[] {
    const records = new Map<string, HandleRecord>();
    const remember = (record: HandleRecord) => {
        records.delete(record.name);
        records.set(record.name, record);
    };
    for (const message of messages) {
        for (const part of message.parts) {
            if (part.type !== 'tool-call' || part.status !== 'done' || part.error || part.toolName === REFRESH_HANDLE_TOOL) continue;
            if (!isRecord(part.result)) continue;
            if (part.toolName === RUN_SQL_TOOL_NAME) {
                if (typeof part.result.savedAs === 'string')
                    remember({ name: part.result.savedAs, toolName: RUN_SQL_TOOL_NAME, args: part.args, fetchedAt: message.createdAt });
                continue;
            }
            if (typeof part.result.handle === 'string' && part.result.handle !== '') {
                remember({ name: part.result.handle, toolName: part.toolName, args: part.args, fetchedAt: message.createdAt });
            }
        }
    }
    return Array.from(records.values());
}

/** Which of `names` the SQL text mentions as a whole word. Names are handle names ([a-z0-9_]). */
export function referencedHandles(sql: string, names: string[]): string[] {
    return names.filter(name => new RegExp(`(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`, 'i').test(sql));
}

/** True when the latest assistant message has a tool call that failed because the session is gone. */
export function hasSessionExpired(messages: ChatMessage[]): boolean {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role !== 'assistant') continue;
        return message.parts.some(
            part => part.type === 'tool-call' && part.error !== undefined && (SESSION_ERROR_CODES as readonly string[]).includes(part.error.error),
        );
    }
    return false;
}
