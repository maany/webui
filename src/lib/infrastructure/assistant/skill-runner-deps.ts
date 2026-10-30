import type { AgentRunnerDeps } from '@/lib/infrastructure/assistant/tanstack-agent-runner';
import { guardToolsForSkills, skillActivations, skillToolFilter, type SkillActivationTracker } from '@/lib/infrastructure/assistant/skill-activation';

export interface SkillRunnerOptions {
    /** Conversation the runner is about to run (startConversation.id in useAssistantController.runTurn). */
    conversationId: string;
    tracker?: SkillActivationTracker;
}

/**
 * Adds skill narrowing to the runner deps of one turn (AssistantControllerDeps.decorateRunnerDeps): the
 * per-iteration tool filter (phase 1b's AgentRunnerDeps.toolFilter) and the execution guard. The catalog goes
 * through systemPromptSections and the skill source through toolContextExtras. Never adds a tool, never
 * changes a policy.
 */
export function decorateRunnerDepsWithSkills(deps: AgentRunnerDeps, options: SkillRunnerOptions): AgentRunnerDeps {
    const tracker = options.tracker ?? skillActivations;
    const skillFilter = skillToolFilter(options.conversationId, tracker);
    const previousFilter = deps.toolFilter;
    return {
        ...deps,
        tools: guardToolsForSkills(deps.tools, tracker),
        toolFilter: tools => skillFilter(previousFilter ? previousFilter(tools) : tools),
    };
}
