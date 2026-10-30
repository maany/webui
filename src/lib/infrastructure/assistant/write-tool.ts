import type { ToolSpec } from '@/lib/core/entity/assistant/tool';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import { invalidateForMutation } from '@/lib/infrastructure/query';
import { toast } from '@/lib/infrastructure/hooks/useToast';
import { isToolError } from './tool-types';
import { executeWriteRequest, type FetchLike } from './write-executor';

export interface WriteToolOptions {
    /** INVALIDATION_MAP key. Defaults to the route directory name, e.g. 'create-rule'. */
    mutation?: string;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
}

export function routeName(path: string): string {
    return path.split('/').filter(Boolean).pop() ?? path;
}

/**
 * A write route tool: validates args with the route schema, sends one JSON request,
 * then refreshes cached queries and shows a toast. The policy gate runs before this (runner).
 */
export function defineWriteTool<I>(spec: ToolSpec<I>, options: WriteToolOptions = {}): RegisteredTool<I> {
    const route = spec.route;
    if (!route || spec.executor !== 'feature' || spec.risk === 'read' || route.method === 'GET') {
        throw new Error(`${spec.name} is not a write route tool`);
    }
    const mutation = options.mutation ?? routeName(route.path);

    return {
        spec,
        async execute(args, ctx) {
            const parsed = spec.input.safeParse(args);
            if (!parsed.success) {
                return {
                    error: 'invalid_args',
                    message: parsed.error.issues.map(issue => `${issue.path.map(String).join('.') || 'input'}: ${issue.message}`).join('; '),
                };
            }
            // Fail closed: without the approving account the server cannot check the session still matches it
            if (!ctx.accountKey) {
                return { error: 'denied_by_policy', message: 'The approving account is unknown, so the change was not sent. Nothing changed.' };
            }
            const result = await executeWriteRequest(route, parsed.data, ctx.signal, {
                fetchImpl: options.fetchImpl,
                timeoutMs: options.timeoutMs,
                expectedAccount: ctx.accountKey,
            });
            if (isToolError(result)) return result;

            // Best effort: a failed refetch must not turn a successful write into an error
            void invalidateForMutation(ctx.queryClient, mutation, parsed.data).catch(() => undefined);
            // The write already landed: a failing toast or summary must not turn it into an error
            try {
                toast({ variant: 'success', title: 'Rucio bot made a change', description: spec.describeCall(parsed.data) });
            } catch {
                // ignore
            }
            return result;
        },
    };
}
