'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { ChatMessage, Conversation, MessagePart } from '@/lib/core/entity/assistant/conversation';
import type { PageContext } from '@/lib/core/entity/assistant/page-context';
import type { ResolvedProvider } from '@/lib/core/entity/assistant/provider-config';
import type { RetentionSettings } from '@/lib/core/entity/assistant/settings';
import type { ToolPolicy, ToolRisk } from '@/lib/core/entity/assistant/tool';
import type { Role } from '@/lib/core/entity/auth-models';
import type { FeatureFlagMap } from '@/lib/core/entity/feature-config';
import { addUsage, computeCost, EMPTY_USAGE_TOTALS, type TokenUsage, type TurnUsage } from '@/lib/core/entity/assistant/usage';
import type { AssistantConversationRepositoryPort } from '@/lib/core/port/secondary/assistant-conversation-repository-port';
import type { AssistantDataHandleStorePort } from '@/lib/core/port/secondary/assistant-data-handle-store-port';
import type { AssistantPageActionRegistryPort } from '@/lib/core/port/secondary/assistant-page-action-registry-port';
import { createApprovalsController } from '@/lib/infrastructure/assistant/approvals-controller';
import { KEEP_RECENT_TURNS, messagesAfter, planCompaction, shouldCompact } from '@/lib/infrastructure/assistant/compaction';
import type { AssistantEventBus } from '@/lib/infrastructure/assistant/event-bus';
import {
    addApprovalPart,
    applyRunnerUpdate,
    closeReasoning,
    createAssistantMessage,
    createId,
    expireStaleParts,
    monotonicIso,
} from '@/lib/infrastructure/assistant/message-reducer';
import { navigationNote } from '@/lib/infrastructure/assistant/page-context';
import { CONTEXT_OVERFLOW_ERROR, SESSION_EXPIRED_ERROR, describeRunError } from '@/lib/infrastructure/assistant/runner-errors';
import { buildSystemPrompt, COMPACTION_SYSTEM_PROMPT, transcriptForSummary } from '@/lib/infrastructure/assistant/system-prompt';
import type { AgentRunner, AgentRunnerDeps } from '@/lib/infrastructure/assistant/tanstack-agent-runner';
import { isInvalidArgsMarker } from '@/lib/infrastructure/assistant/tanstack-tools';
import type { RegisteredTool, ToolExecutionContext } from '@/lib/infrastructure/assistant/tool-types';

export interface PendingApproval {
    toolCallId: string;
    toolName: string;
    args: unknown;
    summary: string; // spec.describeCall(args)
    risk: ToolRisk;
    allowConversationScope: boolean; // false for 'high'
}

export interface UseAssistantResult {
    status: 'idle' | 'streaming' | 'awaiting-approval' | 'error';
    conversation: Conversation | undefined;
    conversations: Conversation[];
    messages: ChatMessage[];
    pendingApprovals: PendingApproval[];
    contextFraction: number | null; // prompt tokens / context window
    error?: string;
    /** True when the last turn failed because the Rucio session expired; the panel offers a login link. */
    sessionExpired?: boolean;
    send(text: string, options?: { attachPageContext?: boolean }): Promise<void>;
    stop(): void;
    resolveApproval(toolCallId: string, decision: 'approved' | 'rejected', scope: 'once' | 'conversation'): void;
    newConversation(): void;
    openConversation(id: string): Promise<void>;
    deleteConversation(id: string): Promise<void>;
    /**
     * Deletes every conversation of an account (default: the active one), stopping any running turn first.
     * The explicit key lets a sign-out that runs after the session is gone still stop and tombstone its turn.
     */
    deleteAllConversations?(accountKey?: string): Promise<void>;
    /** Deletes every conversation of every account, stopping any running turn first. */
    deleteAllAccountsConversations?(): Promise<void>;
    /** False when IndexedDB is unavailable and history lives in memory only. */
    persistent?: boolean;
    /** Context window of the model used for the last turn, for the gauge label. */
    contextWindow?: number;
    /** Context that would be attached to the next message. */
    pageContext?: PageContext;
    /** Re-runs the last user message after an error. */
    retry?(): Promise<void>;
    /** Lets the model continue after the step limit. */
    continueTurn?(): Promise<void>;
    /** Reloads the history list, for example after the settings page deleted conversations. */
    refreshConversations?(): Promise<void>;
}

export interface AssistantControllerDeps {
    /** `${account}@${vo}` of the active session account, undefined when signed out. */
    accountKey: string | undefined;
    repository: Promise<{ repository: AssistantConversationRepositoryPort; persistent: boolean }>;
    resolveProvider(): ResolvedProvider | { error: string };
    /** Tools offered this turn, already filtered by toolVisibility. */
    visibleTools(): RegisteredTool<any>[];
    /** Builds the runner's live policyFor (createPolicyFor in AssistantProvider). */
    makePolicyFor(getConversationAllow: () => ReadonlySet<string>): (toolName: string) => ToolPolicy;
    /** Extra system prompt sections for this turn (phase 2 data tools, phase 5 skill catalog). */
    systemPromptSections?(): string[];
    /** Extra ToolExecutionContext fields (phase 3 flags, role, minimizePanel; later phases add more). */
    toolContextExtras(): {
        flags?: FeatureFlagMap;
        role?: Role;
        minimizePanel?: () => void;
        /** Phase 2: find_tools active set, live tool visibility and policy, handle provenance. */
        /** Called with the conversation the tool context belongs to, which may no longer be the open one. */
        activateTools?: (names: string[], conversationId: string) => void;
        isToolVisible?: ToolExecutionContext['isToolVisible'];
        toolPolicy?: ToolExecutionContext['toolPolicy'];
        handleRecords?: ToolExecutionContext['handleRecords'];
    };
    pageContext(): PageContext | undefined;
    retention(): RetentionSettings;
    handles: AssistantDataHandleStorePort;
    pages: AssistantPageActionRegistryPort;
    bus: AssistantEventBus;
    navigate(url: string): void;
    queryClient: QueryClient;
    createRunner(deps: () => AgentRunnerDeps): AgentRunner;
    summarize(input: {
        provider: ResolvedProvider;
        system: string;
        prompt: string;
        threadId: string;
        signal?: AbortSignal;
    }): Promise<{ text: string; usage?: TokenUsage }>;
    maxSteps?: number;
}

const DEFAULT_MAX_STEPS = 25;
const TITLE_MAX_CHARS = 60;

function providerErrorMessage(error: string): string {
    switch (error) {
        case 'no-provider':
            return 'No model is configured. Add a provider in Rucio bot settings.';
        case 'byok-disabled':
            return 'Your operator does not allow personal providers. Switch to the operator model in settings.';
        case 'kind-not-allowed':
            return 'Your operator does not allow this provider type. Pick another provider in settings.';
        default:
            return error;
    }
}

function titleFrom(text: string): string {
    const line = text.split('\n')[0].trim();
    return line.length > TITLE_MAX_CHARS ? `${line.slice(0, TITLE_MAX_CHARS - 3)}...` : line;
}

/** True when the error means the Rucio session no longer works (directly, or as a 401 from the operator relay). */
function isSessionExpired(error: string, relay: boolean): boolean {
    return error === SESSION_EXPIRED_ERROR || (relay && /\b401\b/.test(error));
}

function sumUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
    return {
        inputTokens: a.inputTokens + b.inputTokens,
        outputTokens: a.outputTokens + b.outputTokens,
        cachedInputTokens: (a.cachedInputTokens ?? 0) + (b.cachedInputTokens ?? 0),
    };
}

interface TurnOptions {
    allowOverflowRetry: boolean;
    forceCompaction: boolean;
    assistantId?: string;
    /** Generation of the original turn, so a retry never outlives a reset. */
    generation?: number;
}

/**
 * All Rucio bot chat state for one account: conversations, the streaming
 * turn, approvals, usage, compaction and persistence. AssistantProvider builds
 * the deps; tests pass fakes.
 */
export function useAssistantController(deps: AssistantControllerDeps): UseAssistantResult {
    const depsRef = useRef(deps);
    depsRef.current = deps;

    const [status, setStatusState] = useState<UseAssistantResult['status']>('idle');
    const [conversation, setConversationState] = useState<Conversation | undefined>(undefined);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [messages, setMessagesState] = useState<ChatMessage[]>([]);
    const [pendingApprovals, setPendingState] = useState<PendingApproval[]>([]);
    const [contextFraction, setContextFractionState] = useState<number | null>(null);
    const [error, setError] = useState<string | undefined>(undefined);
    const [sessionExpired, setSessionExpired] = useState(false);
    const [persistent, setPersistent] = useState(true);
    const [contextWindow, setContextWindow] = useState<number | undefined>(undefined);

    const conversationRef = useRef<Conversation | undefined>(undefined);
    const messagesRef = useRef<ChatMessage[]>([]);
    const pendingRef = useRef<PendingApproval[]>([]);
    const contextFractionRef = useRef<number | null>(null);
    const assistantRef = useRef<ChatMessage | null>(null);
    /** Latest message of every running turn by id, so a superseded turn never reads the next turn's message. */
    const turnMessagesRef = useRef(new Map<string, ChatMessage>());
    const abortRef = useRef<AbortController | null>(null);
    const runnerRef = useRef<AgentRunner | null>(null);
    /** Owner token of the turn (or send) in flight; set synchronously so two sends cannot both start. */
    const busyRef = useRef<object | null>(null);
    const deletingAllRef = useRef(false);
    const deletedRef = useRef<Set<string>>(new Set());
    /** Message ids a retry removed: a superseded turn must not write them back. */
    const deletedMessagesRef = useRef<Set<string>>(new Set());
    const openSeqRef = useRef(0);
    const generationRef = useRef(0);
    const lastContextRouteRef = useRef<string | undefined>(undefined);
    const accountRef = useRef(deps.accountKey);
    const turnIdRef = useRef('');

    const setConversation = useCallback((next: Conversation | undefined) => {
        conversationRef.current = next;
        setConversationState(next);
    }, []);
    const setMessages = useCallback((next: ChatMessage[]) => {
        messagesRef.current = next;
        setMessagesState(next);
    }, []);
    const setPending = useCallback((next: PendingApproval[]) => {
        pendingRef.current = next;
        setPendingState(next);
        if (busyRef.current) setStatusState(next.length > 0 ? 'awaiting-approval' : 'streaming');
    }, []);
    const setContextFraction = useCallback((next: number | null) => {
        contextFractionRef.current = next;
        setContextFractionState(next);
    }, []);
    const replaceMessage = useCallback(
        (message: ChatMessage) => {
            if (deletedMessagesRef.current.has(message.id)) return;
            const current = messagesRef.current;
            const index = current.findIndex(item => item.id === message.id);
            setMessages(index < 0 ? [...current, message] : [...current.slice(0, index), message, ...current.slice(index + 1)]);
        },
        [setMessages],
    );

    const release = useCallback((token: object) => {
        if (busyRef.current === token) busyRef.current = null;
    }, []);

    const refreshConversations = useCallback(async () => {
        const accountKey = depsRef.current.accountKey;
        if (!accountKey) {
            setConversations([]);
            return;
        }
        const { repository } = await depsRef.current.repository;
        const list = await repository.listConversations(accountKey);
        if (depsRef.current.accountKey !== accountKey) return;
        setConversations(list);
        const current = conversationRef.current;
        if (current && !list.some(item => item.id === current.id) && !busyRef.current) {
            generationRef.current += 1;
            setConversation(undefined);
            setMessages([]);
        }
    }, [setConversation, setMessages]);

    const approvals = useMemo(
        () =>
            createApprovalsController({
                getMessage: () => assistantRef.current,
                setMessage: message => {
                    assistantRef.current = message;
                    turnMessagesRef.current.set(message.id, message);
                    replaceMessage(message);
                },
                // Only reached while a turn is torn down: the turn is aborted first, so nothing resumes.
                resolveRunner: (toolCallId, approved) => {
                    if (!abortRef.current?.signal.aborted) runnerRef.current?.resolveApproval(toolCallId, approved);
                },
                approver: () => depsRef.current.accountKey ?? '',
                turnId: () => turnIdRef.current,
                emit: event => depsRef.current.bus.emit(event),
            }),
        [replaceMessage],
    );

    const resetView = useCallback(() => {
        abortRef.current?.abort();
        approvals.expireOpen();
        generationRef.current += 1;
        openSeqRef.current += 1;
        busyRef.current = null;
        setPending([]);
        setConversation(undefined);
        setMessages([]);
        setStatusState('idle');
        setError(undefined);
        setSessionExpired(false);
        setContextFraction(null);
        setContextWindow(undefined);
        lastContextRouteRef.current = undefined;
        void depsRef.current.handles.dropAll();
    }, [approvals, setConversation, setContextFraction, setMessages, setPending]);

    // First mount: open storage, load history, enforce retention.
    useEffect(() => {
        let cancelled = false;
        let unsubscribe: (() => void) | undefined;
        void (async () => {
            const { repository, persistent: isPersistent } = await depsRef.current.repository;
            if (cancelled) return;
            setPersistent(isPersistent);
            unsubscribe = repository.onPersistenceLost?.(() => setPersistent(false));
            await repository
                .enforceRetention(
                    depsRef.current.retention(),
                    new Date(),
                    [conversationRef.current?.id].filter((id): id is string => typeof id === 'string'),
                )
                .catch(() => []);
            if (!cancelled) await refreshConversations();
        })();
        return () => {
            cancelled = true;
            unsubscribe?.();
            abortRef.current?.abort();
        };
    }, [refreshConversations]);

    // Account switch: close the conversation, drop approvals and data tables, show the new account's history.
    useEffect(() => {
        if (accountRef.current === deps.accountKey) return;
        accountRef.current = deps.accountKey;
        resetView();
        void refreshConversations();
    }, [deps.accountKey, refreshConversations, resetView]);

    const compact = useCallback(
        async (
            current: Conversation,
            history: ChatMessage[],
            provider: ResolvedProvider,
            signal: AbortSignal,
            force: boolean,
            isCurrent: () => boolean,
        ): Promise<ChatMessage[]> => {
            const plan = planCompaction(history, KEEP_RECENT_TURNS) ?? (force ? planCompaction(history, 1) : undefined);
            if (!plan) return history;
            try {
                const { repository } = await depsRef.current.repository;
                const { text } = await depsRef.current.summarize({
                    provider,
                    system: COMPACTION_SYSTEM_PROMPT,
                    prompt: transcriptForSummary(plan.summarize, current.compactedSummary),
                    threadId: `${current.id}-summary`,
                    signal,
                });
                if (!text) return history;
                if (signal.aborted || !isCurrent()) return history;
                const live = conversationRef.current?.id === current.id ? conversationRef.current : current;
                const updated: Conversation = { ...live, compactedSummary: text, compactedUpToMessageId: plan.upToMessageId };
                setConversation(updated);
                if (!deletedRef.current.has(current.id)) await repository.saveConversation(updated);
                depsRef.current.bus.emit({ type: 'compaction', conversationId: current.id, upToMessageId: plan.upToMessageId, at: Date.now() });
                if (isCurrent()) setContextFraction(null);
                return plan.keep;
            } catch (compactError) {
                if (compactError instanceof Error && compactError.message === SESSION_EXPIRED_ERROR) throw compactError;
                return history;
            }
        },
        [setContextFraction, setConversation],
    );

    const runTurn = useCallback(
        async (
            conversation: Conversation,
            userMessage: ChatMessage,
            provider: ResolvedProvider,
            options: TurnOptions,
            token: object,
        ): Promise<void> => {
            const generation = options.generation ?? generationRef.current;
            const isCurrent = () => generation === generationRef.current;
            const d = depsRef.current;
            const startConversation = conversation;
            const alive = () => !deletedRef.current.has(startConversation.id);
            const saveMessage = async (message: ChatMessage) => {
                if (!alive() || deletedMessagesRef.current.has(message.id)) return;
                await repository.saveMessage(message);
                // A retry may have removed this message while the write was in flight.
                if (deletedMessagesRef.current.has(message.id)) await repository.deleteMessage(message.id).catch(() => undefined);
            };
            const latestConversation = () => (conversationRef.current?.id === startConversation.id ? conversationRef.current : startConversation);
            const { repository } = await d.repository;
            if (!isCurrent()) {
                release(token);
                return;
            }
            const controller = new AbortController();
            abortRef.current = controller;
            setStatusState('streaming');
            setError(undefined);
            setSessionExpired(false);

            const turnId = createId();
            turnIdRef.current = turnId;
            const started = Date.now();
            const before = messagesRef.current.slice(
                0,
                Math.max(
                    0,
                    messagesRef.current.findIndex(message => message.id === userMessage.id),
                ),
            );
            let history = messagesAfter(before, startConversation.compactedUpToMessageId);
            if (options.forceCompaction || shouldCompact(contextFractionRef.current)) {
                try {
                    history = await compact(startConversation, history, provider, controller.signal, options.forceCompaction, isCurrent);
                } catch {
                    // The relay no longer accepts the session: stop before any model call.
                    release(token);
                    if (abortRef.current === controller) abortRef.current = null;
                    if (isCurrent()) {
                        setSessionExpired(true);
                        setError(describeRunError(SESSION_EXPIRED_ERROR, { relay: provider.via === 'relay' }));
                        setStatusState('error');
                    }
                    return;
                }
                if (controller.signal.aborted || !isCurrent()) {
                    // Stopped or replaced while summarising: do not call the model.
                    release(token);
                    if (abortRef.current === controller) abortRef.current = null;
                    if (isCurrent()) setStatusState('idle');
                    return;
                }
            }

            const assistant: ChatMessage = {
                ...createAssistantMessage(startConversation.id),
                ...(options.assistantId ? { id: options.assistantId } : {}),
            };
            assistantRef.current = assistant;
            turnMessagesRef.current.set(assistant.id, assistant);
            const readMessage = () => turnMessagesRef.current.get(assistant.id) ?? assistant;
            const storeMessage = (message: ChatMessage) => {
                turnMessagesRef.current.set(assistant.id, message);
                if (assistantRef.current?.id === assistant.id) assistantRef.current = message;
            };
            if (isCurrent()) replaceMessage(assistant);
            d.bus.emit({
                type: 'turn-started',
                conversationId: startConversation.id,
                turnId,
                providerKind: provider.kind,
                model: provider.model,
                at: started,
                userText: userMessage.parts.map(part => (part.type === 'text' ? part.text : '')).join(''),
            });

            const policyFor = d.makePolicyFor(() => new Set(latestConversation().conversationAllow));
            // The runner calls this at the start of the run and again before every model call, so tools loaded by
            // find_tools during the turn are offered on the next step.
            const runner = d.createRunner(() => {
                const tools = depsRef.current.visibleTools();
                return {
                    provider,
                    tools,
                    policyFor,
                    systemPrompt: buildSystemPrompt({
                        toolNames: tools.map(tool => tool.spec.name),
                        compactedSummary: latestConversation().compactedSummary,
                        now: new Date(),
                        extraSections: depsRef.current.systemPromptSections?.() ?? [],
                    }),
                    emit: event => depsRef.current.bus.emit(event),
                    makeToolContext: (toolCallId, toolTurnId) => {
                        const { activateTools, ...extras } = depsRef.current.toolContextExtras();
                        return {
                            signal: controller.signal,
                            conversationId: startConversation.id,
                            turnId: toolTurnId,
                            toolCallId,
                            accountKey: startConversation.accountKey,
                            handles: depsRef.current.handles,
                            pages: depsRef.current.pages,
                            navigate: url => depsRef.current.navigate(url),
                            queryClient: depsRef.current.queryClient,
                            emit: event => depsRef.current.bus.emit(event),
                            ...extras,
                            ...(activateTools ? { activateTools: (names: string[]) => activateTools(names, startConversation.id) } : {}),
                        };
                    },
                    maxSteps: d.maxSteps ?? DEFAULT_MAX_STEPS,
                };
            });
            runnerRef.current = runner;

            let turnTokens: TokenUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
            let sawUsage = false;
            let lastInputTokens: number | null = null;
            let reasoningStartedAt: number | undefined;
            let finalStatus: 'completed' | 'stopped' | 'error' | 'step-limit' = 'completed';
            let finalError: string | undefined;
            let overflow = false;

            try {
                for await (const update of runner.run({
                    conversationId: startConversation.id,
                    turnId,
                    history,
                    userMessage,
                    signal: controller.signal,
                })) {
                    let message: ChatMessage = readMessage();
                    if (update.type === 'reasoning-delta' && reasoningStartedAt === undefined) reasoningStartedAt = Date.now();
                    if (update.type !== 'reasoning-delta' && reasoningStartedAt !== undefined) {
                        message = closeReasoning(message, Date.now() - reasoningStartedAt);
                        reasoningStartedAt = undefined;
                    }
                    if (update.type === 'usage') {
                        sawUsage = true;
                        turnTokens = sumUsage(turnTokens, update.usage);
                        lastInputTokens = update.usage.inputTokens;
                    }
                    if (update.type === 'finished') {
                        finalStatus = update.status;
                        finalError = update.error;
                        if (
                            update.status === 'error' &&
                            update.error === CONTEXT_OVERFLOW_ERROR &&
                            options.allowOverflowRetry &&
                            !controller.signal.aborted &&
                            isCurrent()
                        ) {
                            overflow = true;
                            storeMessage(message);
                            continue;
                        }
                    }
                    message = applyRunnerUpdate(message, update);
                    storeMessage(message);
                    if (update.type === 'approval-required') {
                        const part = message.parts.find(item => item.type === 'tool-call' && item.toolCallId === update.toolCallId);
                        if (part && part.type === 'tool-call' && isCurrent()) {
                            const spec = d.visibleTools().find(tool => tool.spec.name === part.toolName)?.spec;
                            let summary = `Run ${part.toolName}`;
                            try {
                                if (isInvalidArgsMarker(part.args)) summary = `Run ${part.toolName} (invalid arguments)`;
                                else if (spec) summary = spec.describeCall(part.args);
                            } catch {
                                summary = `Run ${part.toolName}`;
                            }
                            const risk = spec?.risk ?? 'write';
                            setPending([
                                ...pendingRef.current,
                                {
                                    toolCallId: part.toolCallId,
                                    toolName: part.toolName,
                                    args: part.args,
                                    summary,
                                    risk,
                                    allowConversationScope: risk !== 'high',
                                },
                            ]);
                        }
                    }
                    if (update.type === 'tool-result' && pendingRef.current.some(item => item.toolCallId === update.toolCallId)) {
                        setPending(pendingRef.current.filter(item => item.toolCallId !== update.toolCallId));
                    }
                    if (isCurrent()) replaceMessage(message);
                    if (update.type === 'tool-result' || update.type === 'approval-required') await saveMessage(message);
                }
            } catch (runError) {
                finalStatus = controller.signal.aborted ? 'stopped' : 'error';
                finalError = runError instanceof Error ? runError.message : String(runError);
                const message = applyRunnerUpdate(readMessage(), { type: 'finished', status: finalStatus, error: finalError });
                storeMessage(message);
                if (isCurrent()) replaceMessage(message);
            }

            if (runnerRef.current === runner) runnerRef.current = null;
            if (overflow && (controller.signal.aborted || !isCurrent())) {
                // Stopped or replaced after the overflow: finish instead of retrying. A stop is not an error.
                overflow = false;
                if (controller.signal.aborted) {
                    finalStatus = 'stopped';
                    finalError = undefined;
                }
                storeMessage(applyRunnerUpdate(readMessage(), { type: 'finished', status: finalStatus, error: finalError }));
            }
            if (!overflow) release(token);
            if (abortRef.current === controller) abortRef.current = null;
            if (isCurrent()) setPending([]);

            const turnUsage: TurnUsage = {
                ...turnTokens,
                costUSD: sawUsage ? computeCost(turnTokens, provider.pricing) : null,
                durationMs: Date.now() - started,
            };
            const finalMessage: ChatMessage = { ...readMessage(), ...(sawUsage ? { usage: turnUsage } : {}) };
            if (assistantRef.current?.id === finalMessage.id) assistantRef.current = null;
            turnMessagesRef.current.delete(finalMessage.id);

            const emitFinished = (status: typeof finalStatus, error: string | undefined) =>
                d.bus.emit({ type: 'turn-finished', turnId, status, usage: turnUsage, ...(error ? { error } : {}), at: Date.now() });

            if (overflow) {
                emitFinished('error', finalError);
                if (!alive()) {
                    release(token);
                    return;
                }
                if (isCurrent()) replaceMessage(finalMessage);
                await runTurn(
                    startConversation,
                    userMessage,
                    provider,
                    { allowOverflowRetry: false, forceCompaction: true, assistantId: finalMessage.id, generation },
                    token,
                );
                return;
            }

            // A conversation deleted while the turn ran must not be written back.
            await saveMessage(finalMessage);
            let updatedConversation: Conversation | undefined;
            if (alive()) {
                const latest = await repository.getConversation(startConversation.id);
                if (latest && alive()) {
                    updatedConversation = {
                        ...latest,
                        ...(isCurrent() && conversationRef.current?.id === latest.id ? conversationRef.current : {}),
                        updatedAt: monotonicIso(),
                        providerId: provider.providerId,
                        model: provider.model,
                        usage: sawUsage ? addUsage(latest.usage ?? EMPTY_USAGE_TOTALS, turnUsage) : latest.usage,
                    };
                    await repository.saveConversation(updatedConversation);
                }
            }
            emitFinished(finalStatus, finalError);

            if (isCurrent()) {
                replaceMessage(finalMessage);
                if (updatedConversation) setConversation(updatedConversation);
                setContextWindow(provider.contextWindow);
                if (lastInputTokens !== null) setContextFraction(provider.contextWindow ? lastInputTokens / provider.contextWindow : null);
                if (finalStatus === 'error') {
                    const relay = provider.via === 'relay';
                    const message = finalError ?? 'Something went wrong.';
                    setError(describeRunError(message, { relay }));
                    setSessionExpired(isSessionExpired(message, relay));
                    setStatusState('error');
                } else {
                    setStatusState('idle');
                }
            }
            void repository
                .enforceRetention(
                    depsRef.current.retention(),
                    new Date(),
                    [conversationRef.current?.id, startConversation.id].filter((id): id is string => typeof id === 'string'),
                )
                .catch(() => [])
                .then(() => refreshConversations());
        },
        [compact, refreshConversations, release, replaceMessage, setContextFraction, setConversation, setPending],
    );

    const send = useCallback(
        async (text: string, options: { attachPageContext?: boolean } = {}) => {
            const trimmed = text.trim();
            if (!trimmed || busyRef.current || deletingAllRef.current) return;
            const token = {};
            busyRef.current = token;
            try {
                const d = depsRef.current;
                const accountKey = d.accountKey;
                setSessionExpired(false);
                if (!accountKey) {
                    setError('Sign in to use Rucio bot.');
                    setStatusState('error');
                    return;
                }
                const provider = d.resolveProvider();
                if ('error' in provider) {
                    setError(providerErrorMessage(provider.error));
                    setStatusState('error');
                    return;
                }
                // A send that starts a turn supersedes a pending open; the early returns above must not.
                openSeqRef.current += 1;
                const generation = generationRef.current;
                const superseded = () => generation !== generationRef.current || depsRef.current.accountKey !== accountKey;
                const { repository } = await d.repository;
                if (superseded()) return;
                let current = conversationRef.current;
                if (!current) {
                    const now = monotonicIso();
                    current = {
                        id: createId(),
                        accountKey,
                        title: titleFrom(trimmed),
                        createdAt: now,
                        updatedAt: now,
                        providerId: provider.providerId,
                        model: provider.model,
                        usage: EMPTY_USAGE_TOTALS,
                        conversationAllow: [],
                        handles: [],
                    };
                    setConversation(current);
                    await repository.saveConversation(current);
                    if (superseded()) return;
                }
                const parts: MessagePart[] = [{ type: 'text', text: trimmed }];
                const context = options.attachPageContext === false ? undefined : d.pageContext();
                if (context) {
                    const note = navigationNote(lastContextRouteRef.current, context);
                    if (note) parts.push({ type: 'notice', level: 'info', text: note });
                    parts.push({ type: 'page-context', context });
                    lastContextRouteRef.current = context.route;
                }
                const userMessage: ChatMessage = { id: createId(), conversationId: current.id, role: 'user', parts, createdAt: monotonicIso() };
                setMessages([...messagesRef.current, userMessage]);
                await repository.saveMessage(userMessage);
                if (superseded()) return;
                void refreshConversations();
                await runTurn(current, userMessage, provider, { allowOverflowRetry: true, forceCompaction: false }, token);
            } finally {
                release(token);
            }
        },
        [refreshConversations, release, runTurn, setConversation, setMessages],
    );

    const retry = useCallback(async () => {
        if (busyRef.current || deletingAllRef.current) return;
        const current = conversationRef.current;
        const all = messagesRef.current;
        let userIndex = -1;
        for (let i = all.length - 1; i >= 0; i--) {
            if (all[i].role === 'user') {
                userIndex = i;
                break;
            }
        }
        if (!current || userIndex < 0) return;
        const token = {};
        busyRef.current = token;
        // Captured before the first await, like send: New chat or an account switch during the delete supersedes this retry.
        const generation = generationRef.current;
        const accountKey = depsRef.current.accountKey;
        const superseded = () => generation !== generationRef.current || depsRef.current.accountKey !== accountKey;
        try {
            setSessionExpired(false);
            const provider = depsRef.current.resolveProvider();
            if ('error' in provider) {
                setError(providerErrorMessage(provider.error));
                setStatusState('error');
                return;
            }
            // The failed message goes away and the retry gets a fresh id, so a turn still winding down
            // under the old id can never write into the retry.
            const failed = all[userIndex + 1];
            if (failed) {
                deletedMessagesRef.current.add(failed.id);
                setMessages(all.filter(message => message.id !== failed.id));
                const { repository } = await depsRef.current.repository;
                if (superseded()) return;
                await repository.deleteMessage(failed.id).catch(() => undefined);
                if (superseded()) return;
            }
            await runTurn(current, all[userIndex], provider, { allowOverflowRetry: true, forceCompaction: false, generation }, token);
        } finally {
            release(token);
        }
    }, [release, runTurn, setMessages]);

    const continueTurn = useCallback(() => send('Continue.', { attachPageContext: false }), [send]);

    const stop = useCallback(() => {
        abortRef.current?.abort();
        approvals.expireOpen();
        setPending([]);
    }, [approvals, setPending]);

    const resolveApproval = useCallback(
        (toolCallId: string, decision: 'approved' | 'rejected', scope: 'once' | 'conversation') => {
            const pending = pendingRef.current.find(item => item.toolCallId === toolCallId);
            const runner = runnerRef.current;
            const accountKey = depsRef.current.accountKey;
            if (!pending || !runner || !accountKey || abortRef.current?.signal.aborted) return;
            const effectiveScope = scope === 'conversation' && pending.allowConversationScope ? 'conversation' : 'once';
            const current = conversationRef.current;
            if (decision === 'approved' && effectiveScope === 'conversation' && current && !current.conversationAllow.includes(pending.toolName)) {
                setConversation({ ...current, conversationAllow: [...current.conversationAllow, pending.toolName] });
            }
            const at = new Date().toISOString();
            if (assistantRef.current) {
                assistantRef.current = addApprovalPart(assistantRef.current, {
                    toolCallId,
                    decision,
                    scope: effectiveScope,
                    approver: accountKey,
                    at,
                });
                turnMessagesRef.current.set(assistantRef.current.id, assistantRef.current);
                replaceMessage(assistantRef.current);
            }
            depsRef.current.bus.emit({
                type: 'tool-approval',
                turnId: turnIdRef.current,
                toolCallId,
                decision,
                scope: effectiveScope,
                approver: accountKey,
                at: Date.now(),
            });
            setPending(pendingRef.current.filter(item => item.toolCallId !== toolCallId));
            runner.resolveApproval(toolCallId, decision === 'approved');
        },
        [replaceMessage, setConversation, setPending],
    );

    const newConversation = useCallback(() => {
        resetView();
    }, [resetView]);

    const openConversation = useCallback(
        async (id: string) => {
            const accountKey = depsRef.current.accountKey;
            if (!accountKey) return;
            let seq = ++openSeqRef.current;
            const stale = () => openSeqRef.current !== seq || depsRef.current.accountKey !== accountKey;
            const { repository } = await depsRef.current.repository;
            const stored = await repository.getConversation(id);
            if (stale() || !stored || stored.accountKey !== accountKey) return;
            resetView();
            seq = openSeqRef.current;
            const loaded = await repository.listMessages(id);
            if (stale()) return;
            const repaired = expireStaleParts(loaded, accountKey, new Date().toISOString());
            await Promise.all(repaired.filter((message, index) => message !== loaded[index]).map(message => repository.saveMessage(message)));
            if (stale()) return;
            setConversation(stored);
            setMessages(repaired);
        },
        [resetView, setConversation, setMessages],
    );

    const deleteConversation = useCallback(
        async (id: string) => {
            // Marked first so a streaming turn of this conversation skips every later write.
            deletedRef.current.add(id);
            if (conversationRef.current?.id === id) resetView();
            const { repository } = await depsRef.current.repository;
            try {
                await repository.deleteConversation(id);
            } catch (deleteError) {
                deletedRef.current.delete(id);
                throw deleteError;
            }
            await refreshConversations();
        },
        [refreshConversations, resetView],
    );

    // Shared by both delete-all flavours: blocks new sends until the delete settles, tombstones every id the
    // delete will remove (so a streaming turn skips its later writes) and un-marks them when the delete fails.
    const deleteConversationsWhere = useCallback(
        async (
            scope: (repository: AssistantConversationRepositoryPort) => Promise<Conversation[]>,
            ownsOpen: (open: Conversation) => boolean,
            remove: (repository: AssistantConversationRepositoryPort) => Promise<void>,
        ) => {
            deletingAllRef.current = true;
            const ids = new Set<string>();
            try {
                const { repository } = await depsRef.current.repository;
                for (const item of await scope(repository)) ids.add(item.id);
                // A turn that created its conversation while the list was loading is covered too.
                const open = conversationRef.current;
                if (open && ownsOpen(open)) ids.add(open.id);
                // Marked first so a streaming turn of any of these skips every later write.
                for (const id of ids) deletedRef.current.add(id);
                if (open && ids.has(open.id)) resetView();
                try {
                    await remove(repository);
                } catch (deleteError) {
                    for (const id of ids) deletedRef.current.delete(id);
                    throw deleteError;
                }
                await refreshConversations();
            } finally {
                deletingAllRef.current = false;
            }
        },
        [refreshConversations, resetView],
    );

    const deleteAllConversations = useCallback(
        async (explicitAccountKey?: string) => {
            const accountKey = explicitAccountKey ?? depsRef.current.accountKey;
            if (!accountKey) return;
            await deleteConversationsWhere(
                repository => repository.listConversations(accountKey),
                open => open.accountKey === accountKey,
                repository => repository.deleteAll(accountKey),
            );
        },
        [deleteConversationsWhere],
    );

    const deleteAllAccountsConversations = useCallback(
        () =>
            deleteConversationsWhere(
                async repository => {
                    const all: Conversation[] = [];
                    for (const account of await repository.listAccounts()) all.push(...(await repository.listConversations(account.accountKey)));
                    return all;
                },
                () => true,
                repository => repository.deleteAllAccounts(),
            ),
        [deleteConversationsWhere],
    );

    return {
        status,
        conversation,
        conversations,
        messages,
        pendingApprovals,
        contextFraction,
        error,
        sessionExpired,
        send,
        stop,
        resolveApproval,
        newConversation,
        openConversation,
        deleteConversation,
        deleteAllConversations,
        deleteAllAccountsConversations,
        persistent,
        contextWindow,
        pageContext: deps.pageContext(),
        retry,
        continueTurn,
        refreshConversations,
    };
}

export const AssistantContext = createContext<UseAssistantResult | null>(null);

/** Rucio bot chat state. Must be used inside AssistantProvider. */
export function useAssistant(): UseAssistantResult {
    const value = useContext(AssistantContext);
    if (!value) throw new Error('useAssistant must be used within an AssistantProvider');
    return value;
}
