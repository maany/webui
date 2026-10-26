import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import { registerTools } from '@/lib/infrastructure/assistant/tool-registry';
import { createActivateSkillTool } from '@/lib/infrastructure/assistant/tools/activate-skill-tool';
import { createSearchDocsTool } from '@/lib/infrastructure/assistant/tools/search-docs-tool';

/** search_docs and activate_skill: always-on core tools backed by the docs index and the skill source. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createKnowledgeTools(): RegisteredTool<any>[] {
    return [createSearchDocsTool(), createActivateSkillTool()];
}

let registered = false;

/** Idempotent, like registerPageTools in phase 3. */
export function registerKnowledgeTools(): void {
    if (registered) return;
    registered = true;
    registerTools(createKnowledgeTools());
}
