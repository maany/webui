import { toolDefinition, type AnyTool, type ChatMiddleware } from '@tanstack/ai';
import type { AnyClientTool } from '@tanstack/ai-client';
import { z } from 'zod';
import type { ToolError, ToolPolicy } from '@/lib/core/entity/assistant/tool';
import { UNAVAILABLE_REASONS } from './tool-availability';
import { NEEDS_APPROVAL_ERROR_TYPE, NOT_READY_ERROR_TYPE, type ToolCallGuard } from './tool-call-guard';
import { isToolError, type RegisteredTool, type ToolExecutionContext } from './tool-types';

/** Shape a rejected approval sends back to the model. */
export const ApprovalRejectSchema = z.object({
    error: z.enum(['rejected_by_user', 'denied_by_policy', 'repeated_failure', 'tool_budget_exhausted']),
    message: z.string(),
    /** The loop guard's stop note, see tool-call-guard. */
    note: z.string().optional(),
    errorType: z.string().optional(),
});

export const REJECTED_BY_USER: ToolError = {
    error: 'rejected_by_user',
    message: 'The user rejected this tool call. Do not retry it unless the user asks you to.',
};

/** The refusal for a denied tool. `reason` is a short user-facing phrase such as "disabled on this server". */
export function deniedByPolicy(toolName: string, reason?: string): ToolError {
    // Still loading is not a real setting: the call may work in a moment, so it is not counted as a failure.
    if (reason === UNAVAILABLE_REASONS.loading)
        return { error: 'denied_by_policy', message: `${toolName} is ${reason}. Tell the user.`, errorType: NOT_READY_ERROR_TYPE };
    const why = reason ? `${toolName} is ${reason}.` : `${toolName} is turned off by the Rucio bot permissions or by the server.`;
    return { error: 'denied_by_policy', message: `${why} Tell the user it is not available; do not retry it or look for a workaround.` };
}

export interface ToolResultObserver {
    (toolCallId: string, result: unknown, error: ToolError | undefined, durationMs: number): void;
}

export interface BuildToolsOptions {
    policyFor(toolName: string): ToolPolicy;
    makeToolContext(toolCallId: string): ToolExecutionContext;
    onResult: ToolResultObserver;
    /** Called just before a tool runs, never for a call that is refused first. */
    onStart?(toolCallId: string, toolName: string, args: unknown): void;
    /**
     * Policies tools were built with earlier in a run. A tool built as ask is rebuilt as ask even if its live policy relaxed,
     * so a pending approval still matches its tool; every other policy, and every execution check, stays live.
     */
    builtWith?: ReadonlyMap<string, ToolPolicy>;
    /** Short user-facing reason a tool is hidden or denied, used in the denied_by_policy message. */
    unavailableReason?(toolName: string): string | undefined;
    /** Per-turn loop guard: records every result and adds the stop note once failures pile up. */
    guard?: Pick<ToolCallGuard, 'settle'>;
}

export interface BuiltTools {
    /** Passed to chat({ tools }). */
    serverTools: AnyTool[];
    /** Passed to the ChatClient so approval interrupts are typed. */
    approvalClientTools: AnyClientTool[];
    /** Policy each tool was built with. */
    builtPolicy: Map<string, ToolPolicy>;
}

const INVALID_ARGS_KEY = '__rucio_invalid_args';

interface InvalidArgsMarker {
    [INVALID_ARGS_KEY]: { message: string; received: unknown };
}

export function isInvalidArgsMarker(value: unknown): value is InvalidArgsMarker {
    return typeof value === 'object' && value !== null && INVALID_ARGS_KEY in value;
}

function invalidArgs(marker: InvalidArgsMarker): ToolError {
    return { error: 'invalid_args', message: marker[INVALID_ARGS_KEY].message };
}

/**
 * TanStack runs no middleware hook when argument validation fails on a tool
 * that needs approval, so the model would get its raw error text. For those
 * tools only, hand TanStack a schema whose JSON Schema conversion is the
 * original, but whose validation never fails: bad arguments become a marker
 * (carrying what the model sent, so the approval prompt can show it) that the
 * policy guard and the execute wrapper turn into invalid_args.
 */
function approvalInput(schema: z.ZodType): z.ZodType {
    const standard = schema['~standard'];
    const lenient = {
        ...standard,
        jsonSchema: standard.jsonSchema,
        validate: async (value: unknown) => {
            const result = await standard.validate(value);
            if (!result.issues) return result;
            const message = `Invalid arguments: ${result.issues.map(issue => issue.message).join('; ')}`;
            return { value: { [INVALID_ARGS_KEY]: { message, received: value } } };
        },
    };
    return Object.create(schema, { '~standard': { value: lenient } }) as z.ZodType;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function buildTanstackTools(tools: RegisteredTool<any>[], options: BuildToolsOptions): BuiltTools {
    const serverTools: AnyTool[] = [];
    const approvalClientTools: AnyClientTool[] = [];
    const builtPolicy = new Map<string, ToolPolicy>();

    const finish = (toolCallId: string, result: unknown, durationMs: number): unknown => {
        const final = options.guard ? options.guard.settle(toolCallId, result) : result;
        options.onResult(toolCallId, final, isToolError(final) ? final : undefined, durationMs);
        return final;
    };

    for (const tool of tools) {
        // Only a stricter build is pinned: a tool built as ask keeps asking so its pending approval still resumes.
        const policy = options.builtWith?.get(tool.spec.name) === 'ask' ? 'ask' : options.policyFor(tool.spec.name);
        builtPolicy.set(tool.spec.name, policy);

        const execute = async (args: unknown, tanstackContext?: { toolCallId?: string }): Promise<unknown> => {
            const toolCallId = tanstackContext?.toolCallId ?? `call_${Date.now()}`;
            const started = Date.now();
            if (options.policyFor(tool.spec.name) === 'deny') {
                return finish(toolCallId, deniedByPolicy(tool.spec.name, options.unavailableReason?.(tool.spec.name)), 0);
            }
            if (isInvalidArgsMarker(args)) return finish(toolCallId, invalidArgs(args), 0);
            if (policy !== 'ask' && options.policyFor(tool.spec.name) === 'ask') {
                const tightened: ToolError = {
                    error: 'denied_by_policy',
                    message: 'This action now needs approval. Ask again to request it.',
                    errorType: NEEDS_APPROVAL_ERROR_TYPE,
                };
                return finish(toolCallId, tightened, 0);
            }
            options.onStart?.(toolCallId, tool.spec.name, args);
            const ctx = options.makeToolContext(toolCallId);
            let result: unknown;
            try {
                result = await tool.execute(args, ctx);
            } catch (error) {
                result = ctx.signal.aborted
                    ? ({ error: 'aborted', message: 'The tool call was stopped.' } satisfies ToolError)
                    : ({ error: 'unavailable', message: errorMessage(error) } satisfies ToolError);
            }
            return finish(toolCallId, result, Date.now() - started);
        };

        if (policy === 'ask') {
            const definition = toolDefinition({
                name: tool.spec.name,
                description: tool.spec.description,
                inputSchema: approvalInput(tool.spec.input),
                needsApproval: true,
                approvalSchema: { reject: ApprovalRejectSchema },
            });
            serverTools.push(definition.server(execute as never) as unknown as AnyTool);
            approvalClientTools.push(definition.client() as unknown as AnyClientTool);
        } else {
            const definition = toolDefinition({
                name: tool.spec.name,
                description: tool.spec.description,
                inputSchema: tool.spec.input,
            });
            serverTools.push(definition.server(execute as never) as unknown as AnyTool);
        }
    }
    return { serverTools, approvalClientTools, builtPolicy };
}

/**
 * Narrows the tools sent with each model call (for example while a skill with
 * allowed-tools is active, phase 5). Runs before every model call. `registered`
 * may be a getter so tools loaded mid-turn (find_tools, phase 2) are judged too.
 */
export function createToolFilterMiddleware(
    filter: (tools: RegisteredTool<any>[]) => RegisteredTool<any>[],
    registered: RegisteredTool<any>[] | (() => RegisteredTool<any>[]),
): ChatMiddleware {
    return {
        name: 'rucio-assistant-tool-filter',
        onConfig: (_ctx, config) => {
            const current = typeof registered === 'function' ? registered() : registered;
            const allowed = new Set(filter(current).map(tool => tool.spec.name));
            return { tools: config.tools.filter(tool => allowed.has(tool.name)) };
        },
    };
}

/**
 * Enforces `deny` at call time and maps TanStack's own tool failures
 * (unparsable JSON, truncated calls, aborts) to the ToolError shape.
 */
export function createPolicyMiddleware(
    policyFor: (toolName: string) => ToolPolicy,
    onResult: ToolResultObserver,
    options: Pick<BuildToolsOptions, 'unavailableReason' | 'guard'> = {},
): ChatMiddleware {
    const finish = (toolCallId: string, error: ToolError, durationMs: number): ToolError => {
        const final = (options.guard ? options.guard.settle(toolCallId, error) : error) as ToolError;
        onResult(toolCallId, final, final, durationMs);
        return final;
    };
    return {
        name: 'rucio-assistant-policy',
        onGuardToolCall: (_ctx, hook) => {
            if (policyFor(hook.toolName) === 'deny') {
                return {
                    type: 'skip',
                    result: finish(hook.toolCallId, deniedByPolicy(hook.toolName, options.unavailableReason?.(hook.toolName)), 0),
                };
            }
            if (isInvalidArgsMarker(hook.args)) return { type: 'skip', result: finish(hook.toolCallId, invalidArgs(hook.args), 0) };
            return undefined;
        },
        onAfterToolCall: (ctx, info) => {
            if (info.ok) return undefined;
            const mapped: ToolError = ctx.signal?.aborted
                ? { error: 'aborted', message: 'The tool call was stopped.' }
                : { error: 'invalid_args', message: errorMessage(info.error) };
            return { type: 'replaceResult', result: finish(info.toolCallId, mapped, info.duration) };
        },
    };
}
