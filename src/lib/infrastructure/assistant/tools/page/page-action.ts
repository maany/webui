import { z } from 'zod';
import type { PageActionInfo } from '@/lib/core/port/secondary/assistant-page-action-registry-port';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import { toolError, toToolError } from '@/lib/infrastructure/assistant/page-tool-errors';
import { isMobileViewport } from './page-tool-utils';

export const PageActionInputSchema = z.object({
    name: z.string().min(1).describe('Action name from navigate or read_current_page, for example rule_create.prefill'),
    args: z.record(z.string(), z.unknown()).optional().describe('Arguments matching the input schema of that action'),
});
export type PageActionInput = z.infer<typeof PageActionInputSchema>;

export interface PageActionResult {
    action: string;
    outcome: string;
    actions: PageActionInfo[];
}

export const PAGE_ACTION_DESCRIPTION =
    'Run an action the current page offers (navigate and read_current_page list them), for example rule_create.prefill or rules.filter. ' +
    'Actions only fill or filter the page; the user reviews and submits forms.';

export function createPageActionTool(): RegisteredTool<PageActionInput> {
    return {
        spec: {
            name: 'page_action',
            domain: 'core',
            description: PAGE_ACTION_DESCRIPTION,
            input: PageActionInputSchema,
            risk: 'read',
            requires: { flags: [] },
            executor: 'page',
            output: 'object',
            alwaysOn: true,
            describeCall: args => `Run page action ${args.name}`,
        },
        async execute(input, ctx) {
            if (ctx.signal.aborted) return toolError('aborted', 'The page action was stopped.');
            try {
                const outcome = await ctx.pages.invoke(input.name, input.args ?? {});
                if (isMobileViewport()) ctx.minimizePanel?.();
                const result: PageActionResult = { action: input.name, outcome, actions: ctx.pages.list() };
                return result;
            } catch (thrown) {
                const error = toToolError(thrown);
                const available = ctx.pages.list().map(action => action.name);
                if (error.error === 'not_found' && !available.includes(input.name)) {
                    return { ...error, message: `${error.message} Available actions: ${available.length > 0 ? available.join(', ') : 'none'}.` };
                }
                return error;
            }
        },
    };
}
