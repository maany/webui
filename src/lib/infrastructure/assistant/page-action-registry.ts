import { z } from 'zod';
import type { ToolError } from '@/lib/core/entity/assistant/tool';
import type {
    AssistantPageActionRegistryPort,
    PageActionInfo,
    PageActionRegistration,
} from '@/lib/core/port/secondary/assistant-page-action-registry-port';
import { PAGE_SUMMARY_MAX_CHARS } from './page-context';

function jsonSchemaOf(schema: z.ZodType<unknown>): unknown {
    try {
        return z.toJSONSchema(schema);
    } catch {
        return {};
    }
}

/**
 * Actions the current page offers to Rucio bot. Pages register on mount and
 * unregister on unmount (phase 3 adds usePageAction / usePageDescribe).
 */
export function createPageActionRegistry(): AssistantPageActionRegistryPort {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actions = new Map<string, PageActionRegistration<any>>();
    const waiters = new Set<() => void>();
    let describer: (() => string) | null = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toInfo = (action: PageActionRegistration<any>): PageActionInfo => ({
        name: action.name,
        description: action.description,
        inputJsonSchema: jsonSchemaOf(action.schema),
        risk: action.risk ?? 'read',
    });

    const list = () => Array.from(actions.values()).map(toInfo);

    return {
        register(action) {
            actions.set(action.name, action);
            for (const wake of Array.from(waiters)) wake();
            return () => {
                if (actions.get(action.name) === action) actions.delete(action.name);
            };
        },
        setDescriber(describe) {
            describer = describe;
        },
        describe() {
            if (!describer) return undefined;
            try {
                const summary = describer().trim();
                return summary ? summary.slice(0, PAGE_SUMMARY_MAX_CHARS) : undefined;
            } catch {
                return undefined;
            }
        },
        list,
        async invoke(name, args) {
            const action = actions.get(name);
            if (!action) {
                const notFound: ToolError = { error: 'not_found', message: `This page has no action named ${name}.` };
                throw notFound;
            }
            // Defense in depth: the page_action tool checks too, but the registry never applies a changing action.
            if ((action.risk ?? 'read') !== 'read') {
                const denied: ToolError = { error: 'denied_by_policy', message: 'This page action changes data and cannot run from Rucio bot yet.' };
                throw denied;
            }
            const parsed = action.schema.safeParse(args);
            if (!parsed.success) {
                const invalid: ToolError = { error: 'invalid_args', message: z.prettifyError(parsed.error) };
                throw invalid;
            }
            return action.apply(parsed.data);
        },
        waitForActions(timeoutMs) {
            return new Promise<PageActionInfo[]>(resolve => {
                const finish = () => {
                    clearTimeout(timer);
                    waiters.delete(finish);
                    resolve(list());
                };
                const timer = setTimeout(finish, timeoutMs);
                waiters.add(finish);
            });
        },
    };
}
