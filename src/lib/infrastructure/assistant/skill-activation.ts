import type { AssistantEvent } from '@/lib/core/entity/assistant/events';
import type { SkillDefinition } from '@/lib/core/entity/assistant/skill';
import type { ToolError } from '@/lib/core/entity/assistant/tool';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';

export const ACTIVATE_SKILL_TOOL = 'activate_skill';

export type ActiveSkill = Pick<SkillDefinition, 'name' | 'source' | 'allowedTools'>;

/**
 * Tracks which skills are active, per conversation, for the current turn.
 *
 * - A skill becomes active when activate_skill returns its body and stays active until the next
 *   'turn-started' event of the same conversation (or `clear`). Follow-up turns start unrestricted;
 *   the model activates the skill again when it needs it.
 * - Skills with `allowedTools` narrow the tools: a tool is allowed only when every active skill that
 *   declares `allowedTools` lists it. activate_skill itself always stays allowed. Narrowing never adds
 *   a tool that was not already offered, and never changes a tool's policy.
 */
export interface SkillActivationTracker {
    activate(conversationId: string, skill: ActiveSkill): void;
    active(conversationId: string): ActiveSkill[];
    isActive(conversationId: string, name: string): boolean;
    /** Intersection of the allowed-tools of restricting active skills, or null when nothing restricts. */
    restriction(conversationId: string): string[] | null;
    allows(conversationId: string, toolName: string): boolean;
    clear(conversationId?: string): void;
    /** Subscribe to the assistant event bus so each turn starts with no active skill. */
    onEvent(event: AssistantEvent): void;
}

export function createSkillActivationTracker(): SkillActivationTracker {
    const byConversation = new Map<string, ActiveSkill[]>();

    const tracker: SkillActivationTracker = {
        activate(conversationId, skill) {
            const current = byConversation.get(conversationId) ?? [];
            if (current.some(s => s.name === skill.name)) return;
            const copy: ActiveSkill = { name: skill.name, source: skill.source };
            if (skill.allowedTools) copy.allowedTools = [...skill.allowedTools];
            byConversation.set(conversationId, [...current, copy]);
        },
        active(conversationId) {
            return [...(byConversation.get(conversationId) ?? [])];
        },
        isActive(conversationId, name) {
            return (byConversation.get(conversationId) ?? []).some(s => s.name === name);
        },
        restriction(conversationId) {
            const restricting = (byConversation.get(conversationId) ?? []).filter(s => s.allowedTools !== undefined);
            if (restricting.length === 0) return null;
            const [first, ...rest] = restricting;
            return (first.allowedTools ?? []).filter(tool => rest.every(s => (s.allowedTools ?? []).includes(tool)));
        },
        allows(conversationId, toolName) {
            if (toolName === ACTIVATE_SKILL_TOOL) return true;
            const allowed = tracker.restriction(conversationId);
            return allowed === null || allowed.includes(toolName);
        },
        clear(conversationId) {
            if (conversationId === undefined) byConversation.clear();
            else byConversation.delete(conversationId);
        },
        onEvent(event) {
            if (event.type === 'turn-started') byConversation.delete(event.conversationId);
        },
    };
    return tracker;
}

/** Shared tracker used by activate_skill, the tool guard and the runner's tool filter. */
export const skillActivations = createSkillActivationTracker();

/**
 * Runner tool filter for one conversation, in the shape of phase 1b's AgentRunnerDeps.toolFilter.
 * It only drops tools from the list it is given; it never adds one.
 */
export function skillToolFilter(
    conversationId: string,
    tracker: SkillActivationTracker = skillActivations,
): (tools: RegisteredTool<any>[]) => RegisteredTool<any>[] {
    return tools => tools.filter(tool => tracker.allows(conversationId, tool.spec.name));
}

/**
 * Wraps tools so a call outside the active skills' allowed tools returns a policy error instead of running.
 * Covers calls the model emits in the same step as activate_skill, before the next step's tool list is filtered.
 */
export function guardToolsForSkills(tools: RegisteredTool<any>[], tracker: SkillActivationTracker = skillActivations): RegisteredTool<any>[] {
    return tools.map(tool => ({
        spec: tool.spec,
        execute: async (args, ctx): Promise<unknown | ToolError> => {
            if (!tracker.allows(ctx.conversationId, tool.spec.name)) {
                const names = tracker
                    .active(ctx.conversationId)
                    .map(s => s.name)
                    .join(', ');
                const allowed = tracker.restriction(ctx.conversationId) ?? [];
                return {
                    error: 'denied_by_policy',
                    message: `${tool.spec.name} is not available while the skill ${names} is active. Allowed tools: ${allowed.join(', ') || 'none'}.`,
                };
            }
            return tool.execute(args, ctx);
        },
    }));
}
