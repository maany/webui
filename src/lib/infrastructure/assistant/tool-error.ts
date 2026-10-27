import type { ToolError, ToolErrorCode } from '@/lib/core/entity/assistant/tool';

/** Phase 1b's guard (known error code and a message), re-exported so tool modules import both helpers from here. */
export { isToolError } from '@/lib/infrastructure/assistant/tool-types';

export function toolError(error: ToolErrorCode, message: string, errorType?: string): ToolError {
    return errorType === undefined ? { error, message } : { error, message, errorType };
}

/** Added to a write's error when the server may have applied it before the answer was lost. */
export const MAY_HAVE_LANDED = 'The change may still have been applied, so check its state before retrying.';
