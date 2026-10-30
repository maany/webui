import { act, renderHook } from '@testing-library/react';
import type { AssistantSettings } from '@/lib/core/entity/assistant/settings';
import type { AssistantEvent, AssistantEventListener } from '@/lib/core/entity/assistant/events';
import type { AgentRunnerDeps } from '@/lib/infrastructure/assistant/tanstack-agent-runner';
import type { RegisteredTool, ToolExecutionContext } from '@/lib/infrastructure/assistant/tool-types';
import type { AssistantEventBus } from '@/lib/infrastructure/assistant/event-bus';
import { skillActivations } from '@/lib/infrastructure/assistant/skill-activation';
import { useAssistantSkills } from '@/lib/infrastructure/hooks/useAssistantSkills';
import { useAssistantSettings } from '@/lib/infrastructure/hooks/useAssistantSettings';
import { useAssistantConfig } from '@/lib/infrastructure/hooks/useAssistantConfig';

jest.mock('@/lib/infrastructure/hooks/useAssistantSettings', () => ({ useAssistantSettings: jest.fn() }));
jest.mock('@/lib/infrastructure/hooks/useAssistantConfig', () => ({ useAssistantConfig: jest.fn() }));

function fakeBus(): AssistantEventBus & { listeners: Set<AssistantEventListener> } {
    const listeners = new Set<AssistantEventListener>();
    return {
        listeners,
        emit: (event: AssistantEvent) => listeners.forEach(listener => listener(event)),
        subscribe: listener => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

const tool = (name: string) => ({ spec: { name }, execute: jest.fn(async () => ({ ok: true })) } as unknown as RegisteredTool<unknown>);

function baseDeps(): AgentRunnerDeps {
    return {
        tools: [tool('list_rules'), tool('list_rses'), tool('activate_skill')],
        systemPrompt: 'You are Rucio bot.',
        makeToolContext: (toolCallId: string, turnId: string) => ({ toolCallId, turnId, conversationId: 'c1' } as unknown as ToolExecutionContext),
    } as unknown as AgentRunnerDeps;
}

const names = (tools: ReadonlyArray<{ spec: { name: string } }> | undefined): string[] => (tools ?? []).map(t => t.spec.name);

describe('useAssistantSkills', () => {
    let settings: AssistantSettings;

    beforeEach(() => {
        settings = { version: 1, skills: { enabled: {}, user: [] } } as unknown as AssistantSettings;
        (useAssistantSettings as jest.Mock).mockImplementation(() => ({ settings, update: jest.fn() }));
        (useAssistantConfig as jest.Mock).mockReturnValue({
            config: { operatorSkills: [{ name: 'atlas-naming', description: 'ATLAS DID names.', body: 'Use scope.name.', source: 'operator' }] },
            isLoading: false,
        });
        skillActivations.clear();
    });

    it('lists enabled skills in the prompt sections and exposes the skill source', async () => {
        const { result } = renderHook(() => useAssistantSkills(fakeBus()));
        const [catalog] = result.current.promptSections();
        expect(catalog).toContain('<skill name="atlas-naming" source="operator">ATLAS DID names.</skill>');
        expect(catalog).toContain('<skill name="creating-replication-rules" source="shipped">');
        expect((await result.current.source.get('atlas-naming'))?.body).toBe('Use scope.name.');
    });

    it('reads the latest settings without a new source', async () => {
        const { result, rerender } = renderHook(() => useAssistantSkills(fakeBus()));
        const first = result.current.source;
        settings = { version: 1, skills: { enabled: { 'atlas-naming': false }, user: [] } } as unknown as AssistantSettings;
        rerender();
        expect(result.current.source).toBe(first);
        expect(await first.get('atlas-naming')).toBeUndefined();
        expect(result.current.promptSections().join('\n')).not.toContain('atlas-naming');
    });

    it('filters and guards tools while a restricting skill is active, and resets on the next turn', async () => {
        const bus = fakeBus();
        const { result, unmount } = renderHook(() => useAssistantSkills(bus));
        const deps = result.current.decorate(baseDeps(), 'c1');
        expect(deps.systemPrompt).toBe('You are Rucio bot.');
        expect(names(deps.toolFilter?.(deps.tools))).toEqual(['list_rules', 'list_rses', 'activate_skill']);

        skillActivations.activate('c1', { name: 'rse-expression-basics', source: 'shipped', allowedTools: ['list_rses'] });
        expect(names(deps.toolFilter?.(deps.tools))).toEqual(['list_rses', 'activate_skill']);
        expect(await deps.tools[0].execute({}, deps.makeToolContext('call-1', 'turn-1'))).toMatchObject({ error: 'denied_by_policy' });

        act(() => bus.emit({ type: 'turn-started', conversationId: 'c1', turnId: 'turn-2', providerKind: 'openai', model: 'm', at: 0 }));
        expect(names(deps.toolFilter?.(deps.tools))).toEqual(['list_rules', 'list_rses', 'activate_skill']);

        unmount();
        expect(bus.listeners.size).toBe(0);
    });

    it('keeps an earlier toolFilter and only narrows it', () => {
        const { result } = renderHook(() => useAssistantSkills(fakeBus()));
        const earlier = { ...baseDeps(), toolFilter: tools => tools.filter(t => t.spec.name !== 'list_rses') } as AgentRunnerDeps;
        const deps = result.current.decorate(earlier, 'c1');
        expect(names(deps.toolFilter?.(deps.tools))).toEqual(['list_rules', 'activate_skill']);
    });
});
