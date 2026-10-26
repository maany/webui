import { z } from 'zod';
import type { ToolError } from '@/lib/core/entity/assistant/tool';
import { toolError, isToolError } from './tool-error';

export { toolError, isToolError };

/** Turns anything a page action or the registry throws into a ToolError for the model. */
export function toToolError(thrown: unknown): ToolError {
    if (isToolError(thrown)) return toolError(thrown.error, thrown.message, thrown.errorType);
    if (thrown instanceof z.ZodError) return toolError('invalid_args', z.prettifyError(thrown));
    if (typeof thrown === 'object' && thrown !== null && (thrown as { name?: unknown }).name === 'AbortError') {
        return toolError('aborted', 'The action was stopped.');
    }
    if (thrown instanceof Error) return toolError('unavailable', thrown.message);
    return toolError('unavailable', 'The page action failed.');
}
