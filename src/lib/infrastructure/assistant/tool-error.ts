import type { ToolError, ToolErrorCode } from '@/lib/core/entity/assistant/tool';

/** Phase 1b's guard (known error code and a message), re-exported so tool modules import both helpers from here. */
export { isToolError } from '@/lib/infrastructure/assistant/tool-types';

export function toolError(error: ToolErrorCode, message: string, errorType?: string): ToolError {
    return errorType === undefined ? { error, message } : { error, message, errorType };
}
