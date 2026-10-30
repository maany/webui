import type { ToolSpec } from '@/lib/core/entity/assistant/tool';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';

export const MAX_ACTIVE_TOOLS = 20;

/** Adds names to the active set, most recent last, keeping at most `max` names. */
export function addActiveTools(current: readonly string[], names: readonly string[], max = MAX_ACTIVE_TOOLS): string[] {
    const unique = names.filter((name, index) => names.indexOf(name) === index);
    const next = current.filter(name => !unique.includes(name)).concat(unique);
    return next.slice(Math.max(0, next.length - max));
}

/** Tools offered to the model on the next step: visible and either always on or loaded by find_tools. */
export function selectRunTools(
    all: RegisteredTool<any>[],
    isVisible: (spec: ToolSpec<any>) => boolean,
    active: ReadonlySet<string>,
): RegisteredTool<any>[] {
    return all.filter(tool => isVisible(tool.spec) && (tool.spec.alwaysOn === true || active.has(tool.spec.name)));
}
