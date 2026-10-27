import type { ChatMiddleware } from '@tanstack/ai';
import type { ToolError } from '@/lib/core/entity/assistant/tool';
import { isToolError } from './tool-types';

/** Tool calls one turn may make, parallel calls included, unless the operator sets ASSISTANT_MAX_TOOL_CALLS. */
export const DEFAULT_MAX_TOOL_CALLS = 20;

/** Failed calls in a row after which results tell the model to stop and explain. */
export const CONSECUTIVE_FAILURE_LIMIT = 3;

export const REPEATED_FAILURE: ToolError = {
    error: 'repeated_failure',
    message: 'This exact call already failed in this turn. Do not retry it; tell the user what went wrong or try a different approach.',
};

export const TOOL_BUDGET_EXHAUSTED: ToolError = {
    error: 'tool_budget_exhausted',
    message:
        'This turn has used all of its tool calls, so this call did not run. Do not call more tools now. Tell the user what you found so far; they can press Continue to go on.',
};

export const STOP_AND_EXPLAIN_NOTE = 'Several tool calls in a row have failed. Stop calling tools and explain the problem to the user.';

/** JSON with object keys sorted, so the same arguments in another order give the same text. */
export function canonicalJson(value: unknown): string {
    const seen = new WeakSet<object>();
    const normalise = (input: unknown): unknown => {
        if (typeof input !== 'object' || input === null) return input;
        if (seen.has(input)) return '[circular]';
        seen.add(input);
        if (Array.isArray(input)) return input.map(normalise);
        return Object.fromEntries(
            Object.keys(input)
                .sort()
                .map(key => [key, normalise((input as Record<string, unknown>)[key])]),
        );
    };
    try {
        return JSON.stringify(normalise(value ?? null)) ?? 'null';
    } catch {
        return '"[unserializable]"';
    }
}

/** Failures that say nothing about the call itself: the user said no, or the turn was stopped. */
const NOT_A_FAILURE = new Set<string>(['rejected_by_user', 'aborted']);

export interface ToolCallGuard {
    /**
     * Checks a call before it runs or asks for approval. The first check of a call counts it against the budget; a
     * later check of the same call (after its approval) only looks for a repeated failure. Returns the refusal to send
     * instead of running the call, already recorded as a failure, or undefined to go ahead.
     */
    admit(toolCallId: string, toolName: string, args: unknown): ToolError | undefined;
    /** Records the result of a call once and returns it, with the stop note added when failures pile up. */
    settle(toolCallId: string, result: unknown): unknown;
    /** True once a call was refused because the budget ran out. */
    budgetExceeded(): boolean;
    /**
     * Asked after every tool phase. False once the model has had one reply after the budget ran out, so the turn
     * ends with the step limit.
     */
    continueAfterToolPhase(): boolean;
}

/** Per-turn loop guard. Create one per run so every turn starts with a clean slate. */
export function createToolCallGuard(maxToolCalls: number = DEFAULT_MAX_TOOL_CALLS): ToolCallGuard {
    const limit = Number.isFinite(maxToolCalls) && maxToolCalls > 0 ? Math.floor(maxToolCalls) : DEFAULT_MAX_TOOL_CALLS;
    const keys = new Map<string, string>();
    const settled = new Set<string>();
    const failedKeys = new Set<string>();
    let counted = 0;
    let consecutiveFailures = 0;
    let exceeded = false;
    let exceededBeforePhase = false;

    const withNote = (error: ToolError): ToolError =>
        consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT ? ({ ...error, note: STOP_AND_EXPLAIN_NOTE } as ToolError) : error;

    const settle = (toolCallId: string, result: unknown): unknown => {
        if (settled.has(toolCallId)) return result;
        settled.add(toolCallId);
        if (!isToolError(result)) {
            consecutiveFailures = 0;
            return result;
        }
        if (NOT_A_FAILURE.has(result.error)) return result;
        const key = keys.get(toolCallId);
        if (key !== undefined) failedKeys.add(key);
        consecutiveFailures += 1;
        return withNote(result);
    };

    return {
        admit(toolCallId, toolName, args) {
            const key = `${toolName}:${canonicalJson(args)}`;
            const first = !keys.has(toolCallId);
            keys.set(toolCallId, key);
            let refusal: ToolError | undefined;
            if (first) {
                counted += 1;
                if (counted > limit) {
                    exceeded = true;
                    refusal = TOOL_BUDGET_EXHAUSTED;
                }
            }
            if (!refusal && failedKeys.has(key)) refusal = REPEATED_FAILURE;
            if (!refusal) return undefined;
            return settle(toolCallId, refusal) as ToolError;
        },
        settle,
        budgetExceeded: () => exceeded,
        continueAfterToolPhase() {
            const stop = exceededBeforePhase;
            exceededBeforePhase = exceeded;
            return !stop;
        },
    };
}

function parseArguments(text: string): unknown {
    try {
        return JSON.parse(text.trim() || '{}');
    } catch {
        return text;
    }
}

/**
 * Runs the guard inside TanStack's loop: before any tool runs (after its approval, before argument validation) and
 * after every tool phase. Calls that wait for approval are admitted by the runner when their interrupt arrives.
 */
export function createToolCallGuardMiddleware(guard: ToolCallGuard, onRefused: (toolCallId: string, refusal: ToolError) => void): ChatMiddleware {
    return {
        name: 'rucio-assistant-loop-guard',
        onBeforeToolCall: (_ctx, hook) => {
            const args = hook.args !== undefined ? hook.args : parseArguments(hook.toolCall.function.arguments);
            const refusal = guard.admit(hook.toolCallId, hook.toolName, args);
            if (!refusal) return undefined;
            onRefused(hook.toolCallId, refusal);
            return { type: 'skip', result: refusal };
        },
        onShouldContinue: () => guard.continueAfterToolPhase(),
    };
}
