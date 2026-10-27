'use client';

import React, { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { DataHandleStoreProvider } from './DataHandleStoreContext';
import { useFeatureFlags } from '@/component-library/features/feature-flags/FeatureProvider';
import type { ChatMessage } from '@/lib/core/entity/assistant/conversation';
import type { AssistantEventListener } from '@/lib/core/entity/assistant/events';
import type { ToolSpec } from '@/lib/core/entity/assistant/tool';
import { resolveActiveProvider } from '@/lib/core/services/assistant-provider';
import { toolVisibility } from '@/lib/core/services/assistant-policy';
import { addActiveTools, selectRunTools } from '@/lib/infrastructure/assistant/active-tools';
import { withToolState } from '@/lib/infrastructure/assistant/conversation-tool-state';
import { getAssistantDataHandleStore } from '@/lib/infrastructure/assistant/duckdb';
import { deriveHandleRecords } from '@/lib/infrastructure/assistant/message-selectors';
import { createAssistantEventBus, type AssistantEventBus } from '@/lib/infrastructure/assistant/event-bus';
import { createConversationRepository } from '@/lib/infrastructure/assistant/indexeddb-conversation-repository';
import { lookupModel } from '@/lib/infrastructure/assistant/model-catalog';
import { buildPageContext, toAccountKey } from '@/lib/infrastructure/assistant/page-context';
import { createPolicyFor, type PolicyCaps } from '@/lib/infrastructure/assistant/policy-for';
import { ASSISTANT_RELAY_BASE_URL, DEFAULT_BASE_URLS } from '@/lib/infrastructure/assistant/provider-kinds';
import { completeText, createAgentRunner } from '@/lib/infrastructure/assistant/tanstack-agent-runner';
import { allTools, getTool } from '@/lib/infrastructure/assistant/tool-registry';
import { ASSISTANT_DATA_TOOLS_PROMPT } from '@/lib/infrastructure/assistant/tools';
import { AssistantContext, useAssistantController, type AssistantControllerDeps } from '@/lib/infrastructure/hooks/useAssistant';
import { useSessionGate } from '@/lib/infrastructure/auth/session-gate';
import { useAssistantConfig } from '@/lib/infrastructure/hooks/useAssistantConfig';
import { useAssistantPanel } from '@/lib/infrastructure/hooks/useAssistantShell';
import { useDataHandleLifecycle } from '@/lib/infrastructure/hooks/useDataHandleLifecycle';
import { useAssistantSettings } from '@/lib/infrastructure/hooks/useAssistantSettings';
import { useAssistantSkills } from '@/lib/infrastructure/hooks/useAssistantSkills';
import { usePermissions } from '@/lib/infrastructure/hooks/usePermissions';

export { usePageActionRegistry } from '@/lib/infrastructure/hooks/useAssistantShell';

const AssistantEventBusContext = createContext<AssistantEventBus | null>(null);

export type AssistantProviderOverrides = Partial<Pick<AssistantControllerDeps, 'createRunner' | 'summarize' | 'handles' | 'repository'>>;

/**
 * Owns the event bus, runner factory, conversation repository, data handle
 * store (DuckDB) and the chat controller. Lives in the lazily
 * loaded assistant bundle. Reads only rucioAccount, rucioVO and role from the
 * session, never the session object or its token.
 */
export function AssistantProvider({ children, overrides }: { children: ReactNode; overrides?: AssistantProviderOverrides }) {
    const { data: session } = useSession();
    const accountKey = toAccountKey(session?.user?.rucioAccount, session?.user?.rucioVO);
    const role = session?.user?.role;
    const { config, isLoading: configLoading, isLoaded: configLoaded, error: configError } = useAssistantConfig();
    const { settings } = useAssistantSettings();
    const flags = useFeatureFlags();
    const { isReady } = usePermissions();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const router = useRouter();
    const queryClient = useQueryClient();
    const shell = useAssistantPanel();
    const gateActive = useSessionGate().status === 'active';
    const gateActiveRef = useRef(gateActive);
    gateActiveRef.current = gateActive;
    const [bus] = useState(createAssistantEventBus);
    const assistantSkills = useAssistantSkills(bus);
    // find_tools active set per conversation, persisted as Conversation.activeTools by withToolState.
    const activeToolsRef = useRef<Map<string, string[]>>(new Map());
    const openConversationIdRef = useRef<string | undefined>(undefined);
    const activeNames = (): string[] => (openConversationIdRef.current ? activeToolsRef.current.get(openConversationIdRef.current) ?? [] : []);
    const messagesRef = useRef<ChatMessage[]>([]);
    const conversationAllowRef = useRef<string[]>([]);
    const [handles] = useState(() => overrides?.handles ?? getAssistantDataHandleStore());
    // Every save goes through the wrapper: rows never reach IndexedDB and handle provenance is stored.
    const [repository] = useState(() =>
        (overrides?.repository ?? createConversationRepository()).then(({ repository: stored, persistent }) => ({
            repository: withToolState(stored, id => activeToolsRef.current.get(id)),
            persistent,
        })),
    );

    const configRef = useRef(config);
    configRef.current = config;
    const settingsRef = useRef(settings);
    settingsRef.current = settings;
    // The gate reads this on every tool call: writes fail closed (undefined caps) until the operator config has loaded.
    const policyCapsRef = useRef<PolicyCaps | undefined>(undefined);
    policyCapsRef.current = configLoading || configError || !configLoaded ? undefined : config;

    const isVisible = (spec: Pick<ToolSpec, 'requires' | 'risk'>): boolean =>
        !!flags && toolVisibility(spec, { flags, role, permissionsReady: isReady }).visible;
    // The live gate reads the latest flags, role and permix readiness, so a turn already running sees changes.
    const isVisibleRef = useRef(isVisible);
    isVisibleRef.current = isVisible;

    const makePolicyFor: AssistantControllerDeps['makePolicyFor'] = getConversationAllow =>
        createPolicyFor(
            () => policyCapsRef.current,
            () => settingsRef.current,
            getConversationAllow,
            { isVisible: spec => isVisibleRef.current(spec) },
        );
    // Live checks shared by find_tools, refresh_handle and the Refresh button on SQL results.
    const isToolVisible = (name: string): boolean => {
        const tool = getTool(name);
        return tool !== undefined && isVisible(tool.spec);
    };
    const toolPolicy = (name: string) => makePolicyFor(() => new Set(conversationAllowRef.current))(name);

    const deps: AssistantControllerDeps = {
        accountKey,
        sessionActive: () => gateActiveRef.current,
        repository,
        resolveProvider: () => {
            const resolved = resolveActiveProvider(settingsRef.current, configRef.current, ASSISTANT_RELAY_BASE_URL, lookupModel);
            if ('error' in resolved) return resolved;
            // resolveActiveProvider leaves BYOK base URLs empty; the adapters need the per-kind default.
            return resolved.via === 'direct' && !resolved.baseURL && DEFAULT_BASE_URLS[resolved.kind]
                ? { ...resolved, baseURL: DEFAULT_BASE_URLS[resolved.kind] }
                : resolved;
        },
        // Visible tools that are always on or were loaded by find_tools in this conversation.
        visibleTools: () => selectRunTools(allTools(), isVisible, new Set(activeNames())),
        systemPromptSections: () => [ASSISTANT_DATA_TOOLS_PROMPT, ...assistantSkills.promptSections()],
        makePolicyFor,
        toolContextExtras: () => ({
            ...(flags ? { flags } : {}),
            ...(role ? { role } : {}),
            minimizePanel: shell.minimize,
            activateTools: (names: string[], conversationId: string) => {
                activeToolsRef.current.set(conversationId, addActiveTools(activeToolsRef.current.get(conversationId) ?? [], names));
            },
            isToolVisible,
            toolPolicy,
            handleRecords: () => deriveHandleRecords(messagesRef.current),
            skills: assistantSkills.source,
        }),
        pageContext: () =>
            accountKey
                ? buildPageContext({
                      pathname: pathname ?? '/',
                      searchParams,
                      title: typeof document !== 'undefined' ? document.title : '',
                      accountKey,
                      summary: shell.registry.describe(),
                  })
                : undefined,
        retention: () => settingsRef.current.retention,
        handles,
        pages: shell.registry,
        bus,
        navigate: url => router.push(url),
        queryClient,
        createRunner: overrides?.createRunner ?? (runnerDeps => createAgentRunner(runnerDeps)),
        decorateRunnerDeps: (runnerDeps, conversationId) => assistantSkills.decorate(runnerDeps, conversationId),
        summarize: overrides?.summarize ?? (input => completeText(input)),
    };
    const assistant = useAssistantController(deps);

    // The session left `active` (re-auth dialog or sign-out): stop a running turn the same way the Stop button does.
    const stopRef = useRef(assistant.stop);
    stopRef.current = assistant.stop;
    const statusRef = useRef(assistant.status);
    statusRef.current = assistant.status;
    useEffect(() => {
        if (gateActive) return;
        if (statusRef.current === 'streaming' || statusRef.current === 'awaiting-approval') stopRef.current();
    }, [gateActive]);

    messagesRef.current = assistant.messages;
    conversationAllowRef.current = assistant.conversation?.conversationAllow ?? [];

    // Another conversation (new chat, history, account switch) starts from its own stored active set.
    const openConversationRef = useRef(assistant.conversation);
    openConversationRef.current = assistant.conversation;
    const openConversationId = assistant.conversation?.id;
    openConversationIdRef.current = openConversationId;
    useEffect(() => {
        // A conversation seen before keeps what find_tools loaded in this session; others start from the stored set.
        if (openConversationId && !activeToolsRef.current.has(openConversationId))
            activeToolsRef.current.set(openConversationId, openConversationRef.current?.activeTools ?? []);
    }, [openConversationId]);
    useDataHandleLifecycle(handles);

    const { registerMemoryControls, registerConversationControls, storageVersion } = shell;
    useEffect(
        () =>
            registerMemoryControls({
                memoryBytes: () => handles.memoryBytes(),
                freeMemory: async () => {
                    await handles.dropAll();
                    await handles.terminate();
                },
            }),
        [handles, registerMemoryControls],
    );

    const { deleteConversation, renameConversation, deleteAllConversations, deleteAllAccountsConversations } = assistant;
    useEffect(
        () =>
            registerConversationControls({
                deleteConversation,
                renameConversation,
                deleteAll: async accountKey => {
                    await deleteAllConversations?.(accountKey);
                },
                deleteAllAccounts: async () => {
                    await deleteAllAccountsConversations?.();
                },
            }),
        [deleteConversation, renameConversation, deleteAllConversations, deleteAllAccountsConversations, registerConversationControls],
    );

    const refresh = assistant.refreshConversations;
    useEffect(() => {
        if (storageVersion > 0) void refresh?.();
    }, [storageVersion, refresh]);

    return (
        <AssistantEventBusContext.Provider value={bus}>
            <AssistantContext.Provider value={assistant}>
                <DataHandleStoreProvider store={handles} isToolVisible={isToolVisible} toolPolicy={toolPolicy}>
                    {children}
                </DataHandleStoreProvider>
            </AssistantContext.Provider>
        </AssistantEventBusContext.Provider>
    );
}

/** Subscribes to every assistant event while mounted (timeline, telemetry). */
export function useAssistantEvents(listener: AssistantEventListener): void {
    const bus = useContext(AssistantEventBusContext);
    const listenerRef = useRef(listener);
    listenerRef.current = listener;
    useEffect(() => bus?.subscribe(event => listenerRef.current(event)), [bus]);
}
