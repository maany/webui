import type { ToolError, ToolErrorCode, ToolRisk } from '@/lib/core/entity/assistant/tool';

/** Phase 1b's guard (known error code and a message), re-exported so tool modules import both helpers from here. */
export { isToolError } from '@/lib/infrastructure/assistant/tool-types';

export function toolError(error: ToolErrorCode, message: string, errorType?: string): ToolError {
    return errorType === undefined ? { error, message } : { error, message, errorType };
}

/** Added to a write's error when the server may have applied it before the answer was lost. */
export const MAY_HAVE_LANDED = 'The change may still have been applied, so check its state before retrying.';

/** Why a tool call was cut off before its result arrived. */
export type ToolInterruption = 'stopped' | 'error' | 'save-failed';

const INTERRUPTION_LEAD: Record<ToolInterruption, string> = {
    stopped: 'Stopped by the user.',
    error: 'The turn ended with an error.',
    'save-failed': 'The turn was stopped because the conversation could not be saved.',
};

/**
 * The error recorded for a tool call that was still running when its turn ended. A read was only interrupted; any
 * other tool (or one whose risk is unknown) may have landed, so it says so.
 */
export function interruptedToolError(risk: ToolRisk | undefined, why: ToolInterruption): ToolError {
    if (risk === 'read') return toolError('aborted', why === 'stopped' ? 'The tool call was stopped.' : 'The tool call was interrupted.');
    return toolError('aborted', `${INTERRUPTION_LEAD[why]} ${MAY_HAVE_LANDED}`);
}
