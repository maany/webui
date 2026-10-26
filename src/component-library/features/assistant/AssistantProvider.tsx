'use client';

import React, { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { DataHandleStoreProvider } from './DataHandleStoreContext';
import { useFeatureFlags } from '@/component-library/features/feature-flags/FeatureProvider';
import type { AssistantEventListener } from '@/lib/core/entity/assistant/events';
import { resolveActiveProvider } from '@/lib/core/services/assistant-provider';
import { toolVisibility } from '@/lib/core/services/assistant-policy';
import { createAssistantEventBus, type AssistantEventBus } from '@/lib/infrastructure/assistant/event-bus';
import { createConversationRepository } from '@/lib/infrastructure/assistant/indexeddb-conversation-repository';
import { lookupModel } from '@/lib/infrastructure/assistant/model-catalog';
import { createNoopDataHandleStore } from '@/lib/infrastructure/assistant/noop-data-handle-store';
import { buildPageContext, toAccountKey } from '@/lib/infrastructure/assistant/page-context';
import { createPolicyFor } from '@/lib/infrastructure/assistant/policy-for';
import { ASSISTANT_RELAY_BASE_URL, DEFAULT_BASE_URLS } from '@/lib/infrastructure/assistant/provider-kinds';
import { completeText, createAgentRunner } from '@/lib/infrastructure/assistant/tanstack-agent-runner';
import { allTools } from '@/lib/infrastructure/assistant/tool-registry';
import { AssistantContext, useAssistantController, type AssistantControllerDeps } from '@/lib/infrastructure/hooks/useAssistant';
import { useAssistantConfig } from '@/lib/infrastructure/hooks/useAssistantConfig';
import { useAssistantPanel } from '@/lib/infrastructure/hooks/useAssistantShell';
import { useAssistantSettings } from '@/lib/infrastructure/hooks/useAssistantSettings';
import { usePermissions } from '@/lib/infrastructure/hooks/usePermissions';

export { usePageActionRegistry } from '@/lib/infrastructure/hooks/useAssistantShell';

const AssistantEventBusContext = createContext<AssistantEventBus | null>(null);

export type AssistantProviderOverrides = Partial<Pick<AssistantControllerDeps, 'createRunner' | 'summarize' | 'handles' | 'repository'>>;

/**
 * Owns the event bus, runner factory, conversation repository, data handle
 * store (no-op until phase 2) and the chat controller. Lives in the lazily
 * loaded assistant bundle. Reads only rucioAccount, rucioVO and role from the
 * session, never the session object or its token.
 */
export function AssistantProvider({ children, overrides }: { children: ReactNode; overrides?: AssistantProviderOverrides }) {
    const { data: session } = useSession();
    const accountKey = toAccountKey(session?.user?.rucioAccount, session?.user?.rucioVO);
    const role = session?.user?.role;
    const { config } = useAssistantConfig();
    const { settings } = useAssistantSettings();
    const flags = useFeatureFlags();
    const { isReady } = usePermissions();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const router = useRouter();
    const queryClient = useQueryClient();
    const shell = useAssistantPanel();
    const [bus] = useState(createAssistantEventBus);
    const [handles] = useState(() => overrides?.handles ?? createNoopDataHandleStore());
    const [repository] = useState(() => overrides?.repository ?? createConversationRepository());

    const configRef = useRef(config);
    configRef.current = config;
    const settingsRef = useRef(settings);
    settingsRef.current = settings;

    const deps: AssistantControllerDeps = {
        accountKey,
        repository,
        resolveProvider: () => {
            const resolved = resolveActiveProvider(settingsRef.current, configRef.current, ASSISTANT_RELAY_BASE_URL, lookupModel);
            if ('error' in resolved) return resolved;
            // resolveActiveProvider leaves BYOK base URLs empty; the adapters need the per-kind default.
            return resolved.via === 'direct' && !resolved.baseURL && DEFAULT_BASE_URLS[resolved.kind]
                ? { ...resolved, baseURL: DEFAULT_BASE_URLS[resolved.kind] }
                : resolved;
        },
        visibleTools: () => (flags ? allTools().filter(tool => toolVisibility(tool.spec, { flags, role, permissionsReady: isReady }).visible) : []),
        makePolicyFor: getConversationAllow =>
            createPolicyFor(
                () => configRef.current,
                () => settingsRef.current,
                getConversationAllow,
            ),
        toolContextExtras: () => ({ ...(flags ? { flags } : {}), ...(role ? { role } : {}), minimizePanel: shell.minimize }),
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
        summarize: overrides?.summarize ?? (input => completeText(input)),
    };
    const assistant = useAssistantController(deps);

    // The same live checks refresh_handle applies, for the Refresh button on SQL results.
    const conversationAllowRef = useRef<string[]>([]);
    conversationAllowRef.current = assistant.conversation?.conversationAllow ?? [];
    const refreshGate = {
        isToolVisible: (name: string) => deps.visibleTools().some(tool => tool.spec.name === name),
        toolPolicy: (name: string) => deps.makePolicyFor(() => new Set(conversationAllowRef.current))(name),
    };

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

    const { deleteConversation, deleteAllConversations, deleteAllAccountsConversations } = assistant;
    useEffect(
        () =>
            registerConversationControls({
                deleteConversation,
                deleteAll: async accountKey => {
                    await deleteAllConversations?.(accountKey);
                },
                deleteAllAccounts: async () => {
                    await deleteAllAccountsConversations?.();
                },
            }),
        [deleteConversation, deleteAllConversations, deleteAllAccountsConversations, registerConversationControls],
    );

    const refresh = assistant.refreshConversations;
    useEffect(() => {
        if (storageVersion > 0) void refresh?.();
    }, [storageVersion, refresh]);

    return (
        <AssistantEventBusContext.Provider value={bus}>
            <AssistantContext.Provider value={assistant}>
                <DataHandleStoreProvider store={handles} isToolVisible={refreshGate.isToolVisible} toolPolicy={refreshGate.toolPolicy}>
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
