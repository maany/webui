import type { ToolSpec } from '@/lib/core/entity/assistant/tool';
import { registerTools } from '@/lib/infrastructure/assistant/tool-registry';
import { accountToolSpecs, accountTools } from './accounts';
import { CORE_DATA_TOOLS } from './core-tools';
import { didToolSpecs, didTools } from './dids';
import { registerKnowledgeTools } from './knowledge';
import type { ToolArgs } from './read-tool-helpers';
import { registerPageTools } from './page';
import { replicaToolSpecs, replicaTools } from './replicas';
import { requestToolSpecs, requestTools } from './requests';
import { rseToolSpecs, rseTools } from './rses';
import { ruleToolSpecs, ruleTools } from './rules';
import { subscriptionToolSpecs, subscriptionTools } from './subscriptions';
import { WRITE_TOOLS } from './write-tools';

export { ASSISTANT_DATA_TOOLS_PROMPT } from './prompt';

/** The 35 read route specs, in ToolDomain order. */
export const READ_TOOL_SPECS: ToolSpec<ToolArgs>[] = [
    ...didToolSpecs,
    ...ruleToolSpecs,
    ...rseToolSpecs,
    ...accountToolSpecs,
    ...replicaToolSpecs,
    ...subscriptionToolSpecs,
    ...requestToolSpecs,
];

// Registered once, when this module is first imported (AssistantProvider imports it). Later phases add their
// domain arrays to this call or their own register call below it.
registerTools([...CORE_DATA_TOOLS, ...didTools, ...ruleTools, ...rseTools, ...accountTools, ...replicaTools, ...subscriptionTools, ...requestTools]);

// The 16 write route tools: hidden unless assistant.write is on, every call passes the policy gate.
registerTools(WRITE_TOOLS);

// navigate, read_current_page and page_action: always-on core tools, offered on every turn.
registerPageTools();

// search_docs and activate_skill are core tools offered on every turn.
registerKnowledgeTools();
