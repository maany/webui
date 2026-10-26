import type { ToolSpec } from '@/lib/core/entity/assistant/tool';
import { registerTools } from '@/lib/infrastructure/assistant/tool-registry';
import { accountToolSpecs, accountTools } from './accounts';
import { CORE_DATA_TOOLS } from './core-tools';
import { didToolSpecs, didTools } from './dids';
import type { ToolArgs } from './read-tool-helpers';
import { registerPageTools } from './page';
import { replicaToolSpecs, replicaTools } from './replicas';
import { rseToolSpecs, rseTools } from './rses';
import { ruleToolSpecs, ruleTools } from './rules';
import { subscriptionToolSpecs, subscriptionTools } from './subscriptions';

export { ASSISTANT_DATA_TOOLS_PROMPT } from './prompt';

/** The 34 read route specs, in ToolDomain order. */
export const READ_TOOL_SPECS: ToolSpec<ToolArgs>[] = [
    ...didToolSpecs,
    ...ruleToolSpecs,
    ...rseToolSpecs,
    ...accountToolSpecs,
    ...replicaToolSpecs,
    ...subscriptionToolSpecs,
];

// Registered once, when this module is first imported (AssistantProvider imports it). Later phases add their
// domain arrays to this call (phase 7: requestTools) or their own register call below it (phase 3: registerPageTools).
registerTools([...CORE_DATA_TOOLS, ...didTools, ...ruleTools, ...rseTools, ...accountTools, ...replicaTools, ...subscriptionTools]);

// navigate, read_current_page and page_action: always-on core tools, offered on every turn.
registerPageTools();
