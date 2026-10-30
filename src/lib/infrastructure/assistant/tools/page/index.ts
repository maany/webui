import { getTool, registerTools } from '@/lib/infrastructure/assistant/tool-registry';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import { createNavigateTool } from './navigate';
import { createReadCurrentPageTool } from './read-current-page';
import { createPageActionTool } from './page-action';

export const PAGE_TOOL_NAMES = ['navigate', 'read_current_page', 'page_action'] as const;

export function createPageTools(): RegisteredTool<any>[] {
    return [createNavigateTool(), createReadCurrentPageTool(), createPageActionTool()];
}

/**
 * Adds navigate, read_current_page and page_action to the tool registry. Safe to call more than once;
 * checks the registry itself so it also works after the registry was reset.
 */
export function registerPageTools(): void {
    if (getTool(PAGE_TOOL_NAMES[0])) return;
    registerTools(createPageTools());
}
