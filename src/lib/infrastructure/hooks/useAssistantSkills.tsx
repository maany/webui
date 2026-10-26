'use client';

import * as React from 'react';
import type { AssistantSkillSourcePort } from '@/lib/core/port/secondary/assistant-skill-source-port';
import type { AssistantEventBus } from '@/lib/infrastructure/assistant/event-bus';
import type { AgentRunnerDeps } from '@/lib/infrastructure/assistant/tanstack-agent-runner';
import { createSkillSource, enabledSkills, type SkillCatalogInput } from '@/lib/infrastructure/assistant/skill-source';
import { skillActivations } from '@/lib/infrastructure/assistant/skill-activation';
import { renderSkillCatalog } from '@/lib/infrastructure/assistant/skill-catalog-prompt';
import { decorateRunnerDepsWithSkills } from '@/lib/infrastructure/assistant/skill-runner-deps';
import { SHIPPED_SKILLS } from '@/lib/infrastructure/assistant/skills/shipped-skills.generated';
import { useAssistantConfig } from '@/lib/infrastructure/hooks/useAssistantConfig';
import { useAssistantSettings } from '@/lib/infrastructure/hooks/useAssistantSettings';

export interface UseAssistantSkillsResult {
    /** For toolContextExtras(): ToolExecutionContext.skills, read by activate_skill. */
    source: AssistantSkillSourcePort;
    /** For systemPromptSections(): the catalog of enabled skills (buildSystemPrompt skips an empty one). */
    promptSections(): string[];
    /** For decorateRunnerDeps: wraps the runner deps of one turn of a conversation. */
    decorate(deps: AgentRunnerDeps, conversationId: string): AgentRunnerDeps;
}

/**
 * Skills runtime for AssistantProvider: one skill source over shipped, operator and user skills that always
 * reads the latest settings, the catalog prompt section, and the activation tracker reset at every turn start.
 */
export function useAssistantSkills(bus: AssistantEventBus): UseAssistantSkillsResult {
    const { settings } = useAssistantSettings();
    const { config } = useAssistantConfig();
    const inputRef = React.useRef<SkillCatalogInput>({ shipped: SHIPPED_SKILLS, operator: [], user: [], enabled: {} });
    inputRef.current = {
        shipped: SHIPPED_SKILLS,
        operator: config.operatorSkills,
        user: settings.skills.user,
        enabled: settings.skills.enabled,
    };

    const source = React.useMemo(() => createSkillSource(() => inputRef.current), []);

    React.useEffect(() => {
        const unsubscribe = bus.subscribe(event => skillActivations.onEvent(event));
        return unsubscribe;
    }, [bus]);

    const promptSections = React.useCallback(() => [renderSkillCatalog(enabledSkills(inputRef.current))], []);
    const decorate = React.useCallback((deps: AgentRunnerDeps, conversationId: string) => decorateRunnerDepsWithSkills(deps, { conversationId }), []);

    return { source, promptSections, decorate };
}
