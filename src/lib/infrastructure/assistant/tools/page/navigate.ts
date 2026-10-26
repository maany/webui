import type { AssistantPageActionRegistryPort, PageActionInfo } from '@/lib/core/port/secondary/assistant-page-action-registry-port';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import { isToolError, toolError } from '@/lib/infrastructure/assistant/page-tool-errors';
import { isSafeNavigateUrl } from '@/lib/infrastructure/assistant/in-app-href';
import { NavigateInput, NavigateInputSchema, navigateLabel, resolveNavigateTarget } from './navigate-targets';
import { accountFromKey, isMobileViewport, samePathname, sleep } from './page-tool-utils';

export const NAVIGATE_WAIT_MS = 5000;
const PATHNAME_POLL_MS = 50;
const ACTION_WAIT_SLICE_MS = 250;
const MIN_WAIT_MS = 20;

export interface NavigateResult {
    url: string;
    navigated: boolean;
    actions: PageActionInfo[];
    note?: string;
}

export interface NavigateToolOptions {
    waitMs?: number;
    pollMs?: number;
}

export const NAVIGATE_DESCRIPTION =
    'Open a WebUI page for the user. Pages and params: dashboard; dids (scope, name, type); did (scope, name); ' +
    'rules (account, scope, name, activity, state, updatedAfter, updatedBefore as YYYY-MM-DD); rule (id); ' +
    'rule_create (the create rule wizard); rses (expression); rse (rse); subscriptions (account); ' +
    'subscription (account, name); accounts (admins only); account (account, tab); assistant_settings. ' +
    'Returns the actions the new page offers for page_action. If the user is already on that page, use page_action instead.';

async function waitForPathname(pathname: string, deadline: number, pollMs: number, signal: AbortSignal): Promise<boolean> {
    while (!samePathname(window.location.pathname, pathname)) {
        if (signal.aborted || Date.now() >= deadline) return false;
        await sleep(pollMs);
    }
    return true;
}

/** Waits until an action of the target page is registered, so actions of the previous page are never reported. */
async function waitForPageActions(
    pages: AssistantPageActionRegistryPort,
    prefix: string,
    deadline: number,
    signal: AbortSignal,
): Promise<PageActionInfo[]> {
    for (;;) {
        if (pages.list().some(action => action.name.startsWith(`${prefix}.`))) return pages.list();
        const remaining = deadline - Date.now();
        if (signal.aborted || remaining <= 0) return [];
        const started = Date.now();
        await pages.waitForActions(Math.min(remaining, ACTION_WAIT_SLICE_MS));
        if (Date.now() - started < MIN_WAIT_MS) await sleep(Math.min(PATHNAME_POLL_MS, Math.max(remaining, 0)));
    }
}

export function createNavigateTool(options: NavigateToolOptions = {}): RegisteredTool<NavigateInput> {
    const waitMs = options.waitMs ?? NAVIGATE_WAIT_MS;
    const pollMs = options.pollMs ?? PATHNAME_POLL_MS;

    return {
        spec: {
            name: 'navigate',
            domain: 'core',
            description: NAVIGATE_DESCRIPTION,
            input: NavigateInputSchema,
            risk: 'read',
            requires: { flags: [] },
            executor: 'page',
            output: 'object',
            alwaysOn: true,
            describeCall: args => `Open ${navigateLabel(args)}`,
        },
        async execute(args, ctx) {
            const target = resolveNavigateTarget(args, { flags: ctx.flags, role: ctx.role, account: accountFromKey(ctx.accountKey) });
            if (isToolError(target)) return target;
            if (!isSafeNavigateUrl(target.url)) return toolError('invalid_args', 'That page address is not allowed.');
            if (ctx.signal.aborted) return toolError('aborted', 'Navigation was stopped.');

            if (samePathname(window.location.pathname, target.pathname)) {
                const result: NavigateResult = {
                    url: target.url,
                    navigated: false,
                    actions: ctx.pages.list(),
                    note: `The user is already on ${target.label}. Use page_action to change what it shows.`,
                };
                return result;
            }

            ctx.navigate(target.url);
            if (isMobileViewport()) ctx.minimizePanel?.();

            const deadline = Date.now() + waitMs;
            const arrived = await waitForPathname(target.pathname, deadline, pollMs, ctx.signal);
            if (ctx.signal.aborted) return toolError('aborted', 'Navigation was stopped.');
            if (!arrived) {
                const result: NavigateResult = {
                    url: target.url,
                    navigated: true,
                    actions: [],
                    note: 'The page did not finish loading in time. Call read_current_page to see where the user is.',
                };
                return result;
            }

            if (!target.actionPrefix) {
                const result: NavigateResult = { url: target.url, navigated: true, actions: ctx.pages.list() };
                return result;
            }

            const actions = await waitForPageActions(ctx.pages, target.actionPrefix, deadline, ctx.signal);
            if (ctx.signal.aborted) return toolError('aborted', 'Navigation was stopped.');
            if (actions.length === 0) {
                const result: NavigateResult = {
                    url: target.url,
                    navigated: true,
                    actions: [],
                    note: 'The page has not offered its actions yet. Call read_current_page in a moment to check again.',
                };
                return result;
            }
            const result: NavigateResult = { url: target.url, navigated: true, actions };
            return result;
        },
    };
}
