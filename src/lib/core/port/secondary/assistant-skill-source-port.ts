import type { SkillDefinition } from '@/lib/core/entity/assistant/skill';

export interface AssistantSkillSourcePort {
    list(): Promise<SkillDefinition[]>; // resolved: operator > shipped > user on name collision
    get(name: string): Promise<SkillDefinition | undefined>;
}
