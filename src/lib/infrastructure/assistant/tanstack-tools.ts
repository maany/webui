import { toolDefinition, type AnyTool, type ChatMiddleware } from '@tanstack/ai';
import type { AnyClientTool } from '@tanstack/ai-client';
import { z } from 'zod';
import type { ToolError, ToolPolicy } from '@/lib/core/entity/assistant/tool';
import { isToolError, type RegisteredTool, type ToolExecutionContext } from './tool-types';

/** Shape a rejected approval sends back to the model. */
export const ApprovalRejectSchema = z.object({
    error: z.enum(['rejected_by_user', 'denied_by_policy']),
    message: z.string(),
});

export const REJECTED_BY_USER: ToolError = {
    error: 'rejected_by_user',
    message: 'The user rejected this tool call. Do not retry it unless the user asks you to.',
};

export function deniedByPolicy(toolName: string): ToolError {
    return { error: 'denied_by_policy', message: `The tool ${toolName} is disabled by the user's or operator's policy.` };
}

export interface ToolResultObserver {
    (toolCallId: string, result: unknown, error: ToolError | undefined, durationMs: number): void;
}

export interface BuildToolsOptions {
    policyFor(toolName: string): ToolPolicy;
    makeToolContext(toolCallId: string): ToolExecutionContext;
    onResult: ToolResultObserver;
    /**
     * Policies tools were built with earlier in a run. A tool built as ask is rebuilt as ask even if its live policy relaxed,
     * so a pending approval still matches its tool; every other policy, and every execution check, stays live.
     */
    builtWith?: ReadonlyMap<string, ToolPolicy>;
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

    for (const tool of tools) {
        // Only a stricter build is pinned: a tool built as ask keeps asking so its pending approval still resumes.
        const policy = options.builtWith?.get(tool.spec.name) === 'ask' ? 'ask' : options.policyFor(tool.spec.name);
        builtPolicy.set(tool.spec.name, policy);

        const execute = async (args: unknown, tanstackContext?: { toolCallId?: string }): Promise<unknown> => {
            const toolCallId = tanstackContext?.toolCallId ?? `call_${Date.now()}`;
            const started = Date.now();
            if (options.policyFor(tool.spec.name) === 'deny') {
                const denied = deniedByPolicy(tool.spec.name);
                options.onResult(toolCallId, denied, denied, 0);
                return denied;
            }
            if (isInvalidArgsMarker(args)) {
                const invalid = invalidArgs(args);
                options.onResult(toolCallId, invalid, invalid, 0);
                return invalid;
            }
            if (policy !== 'ask' && options.policyFor(tool.spec.name) === 'ask') {
                const tightened: ToolError = { error: 'denied_by_policy', message: 'This action now needs approval. Ask again to request it.' };
                options.onResult(toolCallId, tightened, tightened, 0);
                return tightened;
            }
            const ctx = options.makeToolContext(toolCallId);
            let result: unknown;
            try {
                result = await tool.execute(args, ctx);
            } catch (error) {
                result = ctx.signal.aborted
                    ? ({ error: 'aborted', message: 'The tool call was stopped.' } satisfies ToolError)
                    : ({ error: 'unavailable', message: errorMessage(error) } satisfies ToolError);
            }
            const durationMs = Date.now() - started;
            options.onResult(toolCallId, result, isToolError(result) ? result : undefined, durationMs);
            return result;
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
 * allowed-tools is active, phase 5). Runs before every model call.
 */
export function createToolFilterMiddleware(
    filter: (tools: RegisteredTool<any>[]) => RegisteredTool<any>[],
    registered: RegisteredTool<any>[],
): ChatMiddleware {
    return {
        name: 'rucio-assistant-tool-filter',
        onConfig: (_ctx, config) => {
            const allowed = new Set(filter(registered).map(tool => tool.spec.name));
            return { tools: config.tools.filter(tool => allowed.has(tool.name)) };
        },
    };
}

/**
 * Enforces `deny` at call time and maps TanStack's own tool failures
 * (unparsable JSON, truncated calls, aborts) to the ToolError shape.
 */
export function createPolicyMiddleware(policyFor: (toolName: string) => ToolPolicy, onResult: ToolResultObserver): ChatMiddleware {
    return {
        name: 'rucio-assistant-policy',
        onGuardToolCall: (_ctx, hook) => {
            if (policyFor(hook.toolName) === 'deny') {
                const denied = deniedByPolicy(hook.toolName);
                onResult(hook.toolCallId, denied, denied, 0);
                return { type: 'skip', result: denied };
            }
            if (isInvalidArgsMarker(hook.args)) {
                const invalid = invalidArgs(hook.args);
                onResult(hook.toolCallId, invalid, invalid, 0);
                return { type: 'skip', result: invalid };
            }
            return undefined;
        },
        onAfterToolCall: (ctx, info) => {
            if (info.ok) return undefined;
            const mapped: ToolError = ctx.signal?.aborted
                ? { error: 'aborted', message: 'The tool call was stopped.' }
                : { error: 'invalid_args', message: errorMessage(info.error) };
            onResult(info.toolCallId, mapped, mapped, info.duration);
            return { type: 'replaceResult', result: mapped };
        },
    };
}
