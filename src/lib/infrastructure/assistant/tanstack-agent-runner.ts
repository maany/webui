import {
    chat,
    fromSpecTokenUsage,
    maxIterations,
    type AnyTextAdapter,
    type ChatMiddleware,
    type ChatMiddlewareConfig,
    type ModelMessage,
    type StreamChunk,
} from '@tanstack/ai';
import { ChatClient, stream } from '@tanstack/ai-client';
import type { ChatMessage, MessagePart } from '@/lib/core/entity/assistant/conversation';
import type { AssistantEvent } from '@/lib/core/entity/assistant/events';
import type { ResolvedProvider } from '@/lib/core/entity/assistant/provider-config';
import type { ToolError, ToolPolicy } from '@/lib/core/entity/assistant/tool';
import { computeCost, type TokenUsage } from '@/lib/core/entity/assistant/usage';
import { ASSISTANT_SCOPE_HEADER, ASSISTANT_SCOPE_OFF_TOPIC, CONTEXT_OVERFLOW_ERROR, OFF_TOPIC_ERROR, SESSION_EXPIRED_ERROR } from './runner-errors';
import { formatUserTurn } from './system-prompt';
import { maskSensitiveArgs } from './approvals';
import { getTool } from './tool-registry';
import { interruptedToolError } from './tool-error';
import { REJECTED_BY_USER, buildTanstackTools, createPolicyMiddleware, createToolFilterMiddleware, deniedByPolicy } from './tanstack-tools';
import { createToolCallGuard, createToolCallGuardMiddleware } from './tool-call-guard';
import { isToolError, type RegisteredTool, type ToolExecutionContext } from './tool-types';

export interface AgentRunnerDeps {
    provider: ResolvedProvider;
    tools: RegisteredTool<any>[]; // already filtered by toolVisibility and active set
    policyFor(toolName: string): ToolPolicy; // live effectivePolicy, read at call time
    systemPrompt: string;
    emit(event: AssistantEvent): void;
    makeToolContext(toolCallId: string, turnId: string): ToolExecutionContext;
    maxSteps: number; // default 25
    /** Tool calls one turn may make, parallel calls included; default DEFAULT_MAX_TOOL_CALLS (20). */
    maxToolCalls?: number;
    /** Short user-facing reason a tool is hidden or denied (flag off, role, permissions), for denied_by_policy messages. */
    unavailableReason?(toolName: string): string | undefined;
    /** Narrows the offered tools before every model call (phase 5 skills). */
    toolFilter?: (tools: RegisteredTool<any>[]) => RegisteredTool<any>[];
}

export interface AgentRunner {
    run(input: {
        conversationId: string;
        turnId: string;
        history: ChatMessage[];
        userMessage: ChatMessage;
        signal: AbortSignal;
    }): AsyncIterable<RunnerUpdate>;
    resolveApproval(toolCallId: string, approved: boolean): void;
}

export type RunnerUpdate =
    | { type: 'text-delta'; text: string }
    | { type: 'reasoning-delta'; text: string }
    | { type: 'tool-call'; toolCallId: string; toolName: string; args: unknown; policy: ToolPolicy }
    | { type: 'approval-required'; toolCallId: string }
    | { type: 'tool-result'; toolCallId: string; result: unknown; error?: ToolError; durationMs: number }
    | { type: 'usage'; usage: TokenUsage }
    | { type: 'finished'; status: 'completed' | 'stopped' | 'error' | 'step-limit'; error?: string; offTopic?: boolean };

/** Signals from the adapter's fetch that the SDK would otherwise bury in a generic connection error. */
export interface AdapterHooks {
    onSessionExpired(): void;
    /** The relay found the user turn off topic: 'warn' still answers, 'block' refused the request. */
    onOffTopic?(mode: 'warn' | 'block'): void;
}

export interface AgentRunnerOptions {
    /** Builds the TanStack adapter. Tests pass a fake; the default is createProviderAdapter. */
    createAdapter?: (provider: ResolvedProvider, hooks: AdapterHooks) => AnyTextAdapter | Promise<AnyTextAdapter>;
}

export const DEFAULT_MAX_STEPS = 25;

/** Placeholder sent as the API key to the operator relay, which injects the real key. */
export const RELAY_PLACEHOLDER_KEY = 'operator-relay';

export type AdapterTarget =
    | { factory: 'anthropic'; model: string; apiKey: string; baseURL?: string }
    | { factory: 'openai'; model: string; apiKey: string; baseURL?: string }
    | { factory: 'openai-compatible'; model: string; apiKey: string; baseURL: string; name: string };

function absolute(url: string, origin: string): string {
    return /^https?:\/\//i.test(url) ? url : new URL(url, origin).toString().replace(/\/+$/, '');
}

/** Decides which TanStack adapter to build and with which URL and key. Pure, so it is unit tested. */
export function resolveAdapterTarget(provider: ResolvedProvider, origin: string): AdapterTarget {
    const relayKey = provider.via === 'relay' ? RELAY_PLACEHOLDER_KEY : '';
    if (provider.kind === 'anthropic') {
        return {
            factory: 'anthropic',
            model: provider.model,
            apiKey: provider.apiKey ?? relayKey,
            ...(provider.baseURL ? { baseURL: absolute(provider.baseURL, origin) } : {}),
        };
    }
    if (provider.kind === 'openai') {
        return {
            factory: 'openai',
            model: provider.model,
            apiKey: provider.apiKey ?? relayKey,
            ...(provider.baseURL ? { baseURL: absolute(provider.baseURL, origin) } : {}),
        };
    }
    if (provider.kind === 'ollama') {
        const base = (provider.baseURL ?? 'http://localhost:11434').replace(/\/+$/, '').replace(/\/v1$/, '');
        return {
            factory: 'openai-compatible',
            name: 'ollama',
            model: provider.model,
            apiKey: provider.apiKey || 'ollama',
            baseURL: `${absolute(base, origin)}/v1`,
        };
    }
    if (!provider.baseURL) throw new Error('This provider has no base URL. Add one in Rucio bot settings.');
    return {
        factory: 'openai-compatible',
        name: 'openai-compatible',
        model: provider.model,
        apiKey: provider.apiKey || relayKey || 'not-needed',
        baseURL: absolute(provider.baseURL, origin),
    };
}

export interface ProviderAdapterOptions {
    /** Page origin used to resolve a relative relay URL; defaults to window.location.origin. */
    origin?: string;
    /** Underlying fetch; defaults to the global one. Tests inject a fake. */
    fetch?: typeof fetch;
    /** Called when the relay shows the session is gone (the SDK only reports a connection error). */
    onSessionExpired?: () => void;
    /** Called when the relay flags the turn as off topic (header, warn) or refuses it (403, block). */
    onOffTopic?: (mode: 'warn' | 'block') => void;
}

async function isOffTopicRefusal(response: Response): Promise<boolean> {
    try {
        const body: unknown = await response.clone().json();
        return typeof body === 'object' && body !== null && (body as { error?: unknown }).error === OFF_TOPIC_ERROR;
    } catch {
        return false;
    }
}

/**
 * Fetch for the operator relay. proxy.ts answers an expired session with a
 * redirect to the login page, which fetch would follow and return as HTML, so
 * redirects stay manual and anything that is not JSON or an event stream is
 * treated as an expired session.
 */
export function createRelayFetch(
    base: typeof fetch = (...args) => fetch(...args),
    onSessionExpired?: () => void,
    onOffTopic?: (mode: 'warn' | 'block') => void,
): typeof fetch {
    const expired = () => {
        onSessionExpired?.();
        return new Error(SESSION_EXPIRED_ERROR);
    };
    return async (input, init) => {
        const response = await base(input, { ...init, redirect: 'manual' });
        const redirected = response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400);
        if (redirected) throw expired();
        if (response.status === 403 && (await isOffTopicRefusal(response))) {
            onOffTopic?.('block');
            throw new Error(OFF_TOPIC_ERROR);
        }
        if (response.ok) {
            if (response.headers.get(ASSISTANT_SCOPE_HEADER) === ASSISTANT_SCOPE_OFF_TOPIC) onOffTopic?.('warn');
            const contentType = response.headers.get('content-type') ?? '';
            if (!/json|event-stream/i.test(contentType)) throw expired();
        }
        return response;
    };
}

/** Builds the TanStack text adapter. Provider SDKs load lazily, so only the chosen one is downloaded. */
export async function createProviderAdapter(provider: ResolvedProvider, options: ProviderAdapterOptions = {}): Promise<AnyTextAdapter> {
    const target = resolveAdapterTarget(provider, options.origin ?? window.location.origin);
    const relayFetch = provider.via === 'relay' ? createRelayFetch(options.fetch, options.onSessionExpired, options.onOffTopic) : options.fetch;
    // The SDKs retry connection failures; a session problem will not heal, so relay calls fail fast.
    const extra = {
        ...(relayFetch ? { fetch: relayFetch } : {}),
        ...(provider.via === 'relay' ? { maxRetries: 0 } : {}),
    };
    if (target.factory === 'anthropic') {
        const { createAnthropicChat } = await import('@tanstack/ai-anthropic');
        type AnthropicModel = Parameters<typeof createAnthropicChat>[0];
        return createAnthropicChat(target.model as AnthropicModel, target.apiKey, {
            dangerouslyAllowBrowser: true,
            ...(target.baseURL ? { baseURL: target.baseURL } : {}),
            ...extra,
        }) as unknown as AnyTextAdapter;
    }
    if (target.factory === 'openai') {
        const { createOpenaiChatCompletions } = await import('@tanstack/ai-openai');
        type OpenAIModel = Parameters<typeof createOpenaiChatCompletions>[0];
        return createOpenaiChatCompletions(target.model as OpenAIModel, target.apiKey, {
            dangerouslyAllowBrowser: true,
            ...(target.baseURL ? { baseURL: target.baseURL } : {}),
            ...extra,
        }) as unknown as AnyTextAdapter;
    }
    const { openaiCompatibleText } = await import('@tanstack/ai-openai/compatible');
    return openaiCompatibleText(target.model, {
        name: target.name,
        baseURL: target.baseURL,
        apiKey: target.apiKey,
        dangerouslyAllowBrowser: true,
        ...extra,
    }) as unknown as AnyTextAdapter;
}

const defaultCreateAdapter = (provider: ResolvedProvider, hooks: AdapterHooks) =>
    createProviderAdapter(provider, { onSessionExpired: hooks.onSessionExpired, onOffTopic: hooks.onOffTopic });

function safeJson(value: unknown): string {
    try {
        return JSON.stringify(value ?? null);
    } catch {
        return '"[unserializable]"';
    }
}

const EXPIRED_APPROVAL: ToolError = {
    error: 'rejected_by_user',
    message: 'The approval request expired before the user decided. The tool did not run.',
};

type ToolCallPart = Extract<MessagePart, { type: 'tool-call' }>;

function toolResultForHistory(part: ToolCallPart): string {
    if (part.status === 'awaiting-approval' || part.status === 'expired') return safeJson(EXPIRED_APPROVAL);
    if (part.error) return safeJson(part.error);
    if (part.result === undefined) return safeJson({ error: 'aborted', message: 'The tool call did not finish.' });
    return safeJson(part.result);
}

/** Converts stored chat messages to TanStack model messages. Reasoning, approvals and notices stay out. */
export function toModelMessages(history: ChatMessage[]): ModelMessage[] {
    const out: ModelMessage[] = [];
    let previousBlocked = false;
    for (const message of history) {
        // A refused off-topic request and its notice-only reply stay visible in the panel but never reach the model.
        const skip = message.offTopic === true || (message.role === 'assistant' && previousBlocked);
        previousBlocked = message.offTopic === true;
        if (skip) continue;
        if (message.role === 'user') {
            out.push({ role: 'user', content: formatUserTurn(message) });
            continue;
        }
        let text = '';
        let calls: ToolCallPart[] = [];
        const flush = () => {
            if (!text && calls.length === 0) return;
            out.push({
                role: 'assistant',
                content: text || null,
                ...(calls.length > 0
                    ? {
                          toolCalls: calls.map(call => ({
                              id: call.toolCallId,
                              type: 'function' as const,
                              function: { name: call.toolName, arguments: safeJson(call.args) },
                          })),
                      }
                    : {}),
            });
            for (const call of calls) out.push({ role: 'tool', toolCallId: call.toolCallId, content: toolResultForHistory(call) });
            text = '';
            calls = [];
        };
        for (const part of message.parts) {
            if (part.type === 'text') {
                if (calls.length > 0) flush();
                text += part.text;
            } else if (part.type === 'tool-call') {
                calls.push(part);
            }
        }
        flush();
    }
    return out;
}

type RawUsage = { promptTokens?: number; completionTokens?: number; promptTokensDetails?: { cachedTokens?: number } };

function toTokenUsage(raw: unknown): TokenUsage | undefined {
    const usage = (Array.isArray(raw) ? fromSpecTokenUsage(raw) : raw) as RawUsage | undefined;
    if (!usage || typeof usage.promptTokens !== 'number') return undefined;
    const cached = usage.promptTokensDetails?.cachedTokens;
    return { inputTokens: usage.promptTokens, outputTokens: usage.completionTokens ?? 0, ...(cached ? { cachedInputTokens: cached } : {}) };
}

function parseToolContent(content: unknown): unknown {
    if (typeof content !== 'string') return content;
    try {
        return JSON.parse(content);
    } catch {
        return content;
    }
}

function summarizeResult(result: unknown): string {
    const text = safeJson(result);
    return text.length > 200 ? `${text.slice(0, 200)}...` : text;
}

function linkedAbortController(signal: AbortSignal | undefined): AbortController {
    const controller = new AbortController();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', () => controller.abort(), { once: true });
    return controller;
}

function createChannel<T>() {
    const items: T[] = [];
    let wake: (() => void) | null = null;
    let closed = false;
    const signal = () => {
        const current = wake;
        wake = null;
        current?.();
    };
    return {
        push(item: T) {
            if (closed) return;
            items.push(item);
            signal();
        },
        close() {
            closed = true;
            signal();
        },
        async *drain(): AsyncGenerator<T> {
            while (true) {
                if (items.length > 0) {
                    yield items.shift() as T;
                    continue;
                }
                if (closed) return;
                await new Promise<void>(resolve => {
                    wake = resolve;
                });
            }
        },
    };
}

/** The part of a TanStack tool-approval interrupt the runner uses. */
interface ApprovalInterruptLike {
    kind: string;
    toolCallId?: string;
    resolveInterrupt(approved: boolean, options?: { payload: ToolError }): void;
}

/**
 * Rebuilds the tool list before every model call of a run. TanStack calls onConfig at init and at the start of
 * each agent iteration, so tools loaded by find_tools (and policy changes) apply to the next step of the same turn.
 */
export function createRefreshToolsMiddleware(rebuild: () => ChatMiddlewareConfig['tools']): ChatMiddleware {
    return {
        name: 'rucio-refresh-tools',
        onConfig: () => ({ tools: rebuild() }),
    };
}

/**
 * The agent loop. One run is one user turn. It drives a headless TanStack
 * ChatClient over an in-process stream() connection, so approval pauses and
 * resumes need no server.
 */
export function createAgentRunner(deps: () => AgentRunnerDeps, options: AgentRunnerOptions = {}): AgentRunner {
    let resolveActive: ((toolCallId: string, approved: boolean) => void) | null = null;

    function run(input: {
        conversationId: string;
        turnId: string;
        history: ChatMessage[];
        userMessage: ChatMessage;
        signal: AbortSignal;
    }): AsyncIterable<RunnerUpdate> {
        const channel = createChannel<RunnerUpdate>();
        const d = deps();
        const durations = new Map<string, number>();
        const toolNames = new Map<string, string>();
        const toolArgsText = new Map<string, string>();
        const toolArgs = new Map<string, unknown>();
        const pendingApprovals = new Set<string>();
        let lastFinishReason: string | null | undefined;
        // Model calls made this turn. Each approval resume starts a fresh chat(), so the limit is enforced here.
        let modelCalls = 0;
        let stepLimitHit = false;
        let runError: { message: string; code?: string } | undefined;
        let sessionExpired = false;
        let offTopicBlocked = false;
        let offTopicWarned = false;
        let callStartedAt = Date.now();
        let callText = '';
        let waiter: (() => void) | null = null;
        const notify = () => {
            const current = waiter;
            waiter = null;
            current?.();
        };
        const recordDuration = (toolCallId: string, _result: unknown, _error: ToolError | undefined, durationMs: number) => {
            durations.set(toolCallId, durationMs);
        };
        // Loop guard of this turn: refuses repeats of failed calls and calls over the budget, and notes failure streaks.
        const guard = createToolCallGuard(d.maxToolCalls);
        const unavailableReason = (name: string) => deps().unavailableReason?.(name);
        const built = buildTanstackTools(d.tools, {
            policyFor: name => d.policyFor(name),
            makeToolContext: toolCallId => d.makeToolContext(toolCallId, input.turnId),
            onResult: recordDuration,
            onStart: (id, name, args) => markRunning(id, name, args),
            unavailableReason,
            guard,
        });
        // Reads deps() again so tools loaded mid-turn by find_tools are offered on the next model call.
        let liveClient: ChatClient | null = null;
        const pinnedAsk = new Map(built.builtPolicy);
        // Tools of the latest rebuild, so masking sees mid-turn tools without calling deps() again per tool call.
        let latestTools = d.tools;
        // Calls already shown, and calls whose tool started but has no result yet.
        const announced = new Set<string>();
        const running = new Map<string, { toolName: string; args: unknown; startedAt: number }>();
        const specFor = (toolName: string) =>
            [latestTools, d.tools].map(list => list.find(tool => tool.spec.name === toolName)).find(Boolean)?.spec ?? getTool(toolName)?.spec;
        const announce = (toolCallId: string, toolName: string, args: unknown) => {
            if (announced.has(toolCallId)) return;
            announced.add(toolCallId);
            const policy = built.builtPolicy.get(toolName) ?? d.policyFor(toolName);
            // Execution keeps TanStack's own args; what is stored, shown and emitted never carries sensitive values.
            const shownArgs = maskSensitiveArgs(args, specFor(toolName)?.sensitiveArgs ?? []);
            channel.push({ type: 'tool-call', toolCallId, toolName, args: shownArgs, policy });
            d.emit({ type: 'tool-call-started', turnId: input.turnId, toolCallId, toolName, args: shownArgs, policy, at: Date.now() });
        };
        // Called by the execute wrapper just before the tool runs. Only records it: the client's own TOOL_CALL_END
        // announces the call in stream order, so pushing here could put the card ahead of text it has not read yet.
        const markRunning = (toolCallId: string, toolName: string, args: unknown) => {
            running.set(toolCallId, { toolName, args: maskSensitiveArgs(args, specFor(toolName)?.sensitiveArgs ?? []), startedAt: Date.now() });
        };
        // A Stop or an error drops the chunks the client has not processed yet, so a tool that already started would
        // leave no result. Show and close it here; a write may have landed, so it says so.
        const closeRunningCalls = (why: 'stopped' | 'error') => {
            running.forEach(({ toolName, args, startedAt }, toolCallId) => {
                announce(toolCallId, toolName, args);
                const error = interruptedToolError(specFor(toolName)?.risk, why);
                const durationMs = Date.now() - startedAt;
                channel.push({ type: 'tool-result', toolCallId, result: error, error, durationMs });
                d.emit({ type: 'tool-call-finished', turnId: input.turnId, toolCallId, durationMs, error, at: Date.now() });
            });
            running.clear();
        };
        const buildTools = () => {
            const fresh = deps();
            latestTools = fresh.tools;
            const rebuilt = buildTanstackTools(fresh.tools, {
                policyFor: name => fresh.policyFor(name),
                makeToolContext: toolCallId => fresh.makeToolContext(toolCallId, input.turnId),
                onResult: recordDuration,
                onStart: (id, name, args) => markRunning(id, name, args),
                // Tools built at the start keep their approval mode, so a pending approval still resumes.
                builtWith: pinnedAsk,
                unavailableReason: name => fresh.unavailableReason?.(name),
                guard,
            });
            // The client resumes approvals through its own tool list, so a tool loaded mid-turn must be added to it.
            rebuilt.builtPolicy.forEach((policy, name) => policy === 'ask' && pinnedAsk.set(name, 'ask'));
            liveClient?.updateOptions({ tools: rebuilt.approvalClientTools });
            return rebuilt.serverTools;
        };
        // Later phases append to this list (for example telemetry or skill middleware). The refresh stays first.
        const middleware: ChatMiddleware[] = [
            createRefreshToolsMiddleware(buildTools),
            createToolCallGuardMiddleware(guard, (toolCallId, refusal) => recordDuration(toolCallId, refusal, refusal, 0)),
            createPolicyMiddleware(name => d.policyFor(name), recordDuration, { unavailableReason, guard }),
        ];
        if (d.toolFilter) middleware.push(createToolFilterMiddleware(d.toolFilter, () => deps().tools));
        const historyMessages = toModelMessages(input.history);

        const drive = async () => {
            let client: ChatClient | null = null;
            let onAbort: (() => void) | null = null;
            let mine: ((toolCallId: string, approved: boolean) => void) | null = null;
            try {
                const adapter = await (options.createAdapter ?? defaultCreateAdapter)(d.provider, {
                    onSessionExpired: () => {
                        sessionExpired = true;
                    },
                    onOffTopic: mode => {
                        if (mode === 'block') offTopicBlocked = true;
                        else offTopicWarned = true;
                    },
                });
                const connection = stream(
                    (messages, _data, abortSignal, runInput) =>
                        chat({
                            adapter,
                            messages: [...historyMessages, ...(messages as ModelMessage[])],
                            systemPrompts: [d.systemPrompt],
                            threadId: runInput.threadId,
                            runId: runInput.runId,
                            parentRunId: runInput.parentRunId,
                            resume: runInput.resume,
                            abortController: linkedAbortController(abortSignal),
                            tools: buildTools(),
                            middleware,
                            agentLoopStrategy: maxIterations(Math.max(d.maxSteps - modelCalls, 0)),
                        }) as AsyncIterable<StreamChunk>,
                );

                const resolveInterrupt = (toolCallId: string, approved: boolean, rejection: ToolError = REJECTED_BY_USER) => {
                    if (!client) return false;
                    const interrupts = client.getInterrupts() as ReadonlyArray<unknown> as ReadonlyArray<ApprovalInterruptLike>;
                    const interrupt = interrupts.find(item => item.kind === 'tool-approval' && item.toolCallId === toolCallId);
                    if (!interrupt) return false;
                    pendingApprovals.delete(toolCallId);
                    if (modelCalls >= d.maxSteps) {
                        // No budget for the model call that would follow: leave the tool unrun and end the turn.
                        stepLimitHit = true;
                        pendingApprovals.clear();
                        notify();
                        return true;
                    }
                    if (approved) interrupt.resolveInterrupt(true);
                    else interrupt.resolveInterrupt(false, { payload: rejection });
                    notify();
                    return true;
                };

                // An interrupt is registered with the client slightly after RUN_FINISHED, so retry briefly.
                const autoResolve = (toolCallId: string, approved: boolean, rejection?: ToolError, attempt = 0) => {
                    if (resolveInterrupt(toolCallId, approved, rejection) || attempt >= 50 || input.signal.aborted) return;
                    setTimeout(() => autoResolve(toolCallId, approved, rejection, attempt + 1), 0);
                };

                const onChunk = (chunk: StreamChunk) => {
                    switch (chunk.type) {
                        case 'RUN_STARTED':
                            callStartedAt = Date.now();
                            callText = '';
                            break;
                        case 'TEXT_MESSAGE_CONTENT':
                            if (chunk.delta) {
                                callText += chunk.delta;
                                channel.push({ type: 'text-delta', text: chunk.delta });
                            }
                            break;
                        case 'REASONING_MESSAGE_CONTENT':
                            if (chunk.delta) channel.push({ type: 'reasoning-delta', text: chunk.delta });
                            break;
                        case 'TOOL_CALL_START':
                            toolNames.set(chunk.toolCallId, chunk.toolCallName);
                            break;
                        case 'TOOL_CALL_ARGS':
                            toolArgsText.set(chunk.toolCallId, (toolArgsText.get(chunk.toolCallId) ?? '') + (chunk.delta ?? ''));
                            break;
                        case 'TOOL_CALL_END': {
                            const toolName = toolNames.get(chunk.toolCallId) ?? 'unknown';
                            const args = chunk.input !== undefined ? chunk.input : parseToolContent(toolArgsText.get(chunk.toolCallId) || '{}');
                            toolArgs.set(chunk.toolCallId, args);
                            announce(chunk.toolCallId, toolName, args);
                            break;
                        }
                        case 'TOOL_CALL_RESULT': {
                            running.delete(chunk.toolCallId);
                            const result = parseToolContent(chunk.content);
                            const error = isToolError(result) ? result : undefined;
                            const durationMs = durations.get(chunk.toolCallId) ?? 0;
                            channel.push({ type: 'tool-result', toolCallId: chunk.toolCallId, result, ...(error ? { error } : {}), durationMs });
                            d.emit({
                                type: 'tool-call-finished',
                                turnId: input.turnId,
                                toolCallId: chunk.toolCallId,
                                durationMs,
                                ...(error ? { error } : { resultSummary: summarizeResult(result) }),
                                at: Date.now(),
                            });
                            callStartedAt = Date.now();
                            callText = '';
                            break;
                        }
                        case 'RUN_FINISHED': {
                            const usage = toTokenUsage(chunk.usage);
                            if (usage) {
                                channel.push({ type: 'usage', usage });
                                d.emit({
                                    type: 'llm-call-finished',
                                    turnId: input.turnId,
                                    usage: { ...usage, costUSD: computeCost(usage, d.provider.pricing), durationMs: Date.now() - callStartedAt },
                                    ...(chunk.finishReason ? { finishReason: chunk.finishReason } : {}),
                                    ...(callText ? { outputText: callText } : {}),
                                    at: Date.now(),
                                });
                            }
                            callText = '';
                            lastFinishReason = chunk.finishReason;
                            modelCalls += 1;
                            if (chunk.outcome?.type === 'interrupt') {
                                for (const interrupt of chunk.outcome.interrupts) {
                                    const toolCallId = interrupt.toolCallId;
                                    if (!toolCallId) continue;
                                    const toolName = toolNames.get(toolCallId) ?? '';
                                    const live = toolName ? d.policyFor(toolName) : 'deny';
                                    pendingApprovals.add(toolCallId);
                                    // Counted here, before the user is asked: a call over the budget or repeating a failure never shows a card.
                                    const refusal = guard.admit(
                                        toolCallId,
                                        toolName || 'unknown',
                                        toolArgs.has(toolCallId) ? toolArgs.get(toolCallId) : parseToolContent(toolArgsText.get(toolCallId) || '{}'),
                                    );
                                    if (refusal) {
                                        recordDuration(toolCallId, refusal, refusal, 0);
                                        queueMicrotask(() => autoResolve(toolCallId, false, refusal));
                                    } else if (live === 'allow') queueMicrotask(() => autoResolve(toolCallId, true));
                                    else if (live === 'deny')
                                        queueMicrotask(() =>
                                            autoResolve(toolCallId, false, deniedByPolicy(toolName || 'unknown', unavailableReason(toolName))),
                                        );
                                    else channel.push({ type: 'approval-required', toolCallId });
                                }
                            }
                            break;
                        }
                        case 'RUN_ERROR':
                            runError = { message: chunk.message, ...(chunk.code ? { code: chunk.code } : {}) };
                            break;
                        default:
                            break;
                    }
                    notify();
                };

                client = new ChatClient({
                    threadId: input.conversationId,
                    connection,
                    tools: built.approvalClientTools,
                    onChunk,
                    onLoadingChange: notify,
                    onInterruptStateChange: notify,
                    onError: error => {
                        runError = runError ?? { message: error.message };
                        notify();
                    },
                });
                const activeClient = client;
                liveClient = client;
                mine = (toolCallId: string, approved: boolean) => void resolveInterrupt(toolCallId, approved);
                resolveActive = mine;
                onAbort = () => {
                    activeClient.stop();
                    notify();
                };
                input.signal.addEventListener('abort', onAbort, { once: true });

                if (!input.signal.aborted) await activeClient.sendMessage(formatUserTurn(input.userMessage));
                while (!input.signal.aborted) {
                    const busy = activeClient.getIsLoading() || activeClient.getInterruptState().resuming;
                    if (!busy && pendingApprovals.size === 0) break;
                    await new Promise<void>(resolve => {
                        waiter = resolve;
                    });
                }

                if (input.signal.aborted) {
                    closeRunningCalls('stopped');
                    channel.push({ type: 'finished', status: 'stopped', ...(offTopicWarned ? { offTopic: true } : {}) });
                } else if (runError) {
                    closeRunningCalls('error');
                    channel.push({
                        type: 'finished',
                        status: 'error',
                        error: sessionExpired
                            ? SESSION_EXPIRED_ERROR
                            : offTopicBlocked
                            ? OFF_TOPIC_ERROR
                            : runError.code === 'context_overflow'
                            ? CONTEXT_OVERFLOW_ERROR
                            : runError.message,
                    });
                } else if (stepLimitHit || guard.budgetExceeded() || lastFinishReason === 'tool_calls') {
                    channel.push({ type: 'finished', status: 'step-limit', ...(offTopicWarned ? { offTopic: true } : {}) });
                } else channel.push({ type: 'finished', status: 'completed', ...(offTopicWarned ? { offTopic: true } : {}) });
            } catch (error) {
                if (input.signal.aborted) closeRunningCalls('stopped');
                else closeRunningCalls('error');
                channel.push(
                    input.signal.aborted
                        ? { type: 'finished', status: 'stopped', ...(offTopicWarned ? { offTopic: true } : {}) }
                        : {
                              type: 'finished',
                              status: 'error',
                              error: sessionExpired
                                  ? SESSION_EXPIRED_ERROR
                                  : offTopicBlocked
                                  ? OFF_TOPIC_ERROR
                                  : error instanceof Error
                                  ? error.message
                                  : String(error),
                          },
                );
            } finally {
                if (onAbort) input.signal.removeEventListener('abort', onAbort);
                if (resolveActive === mine) resolveActive = null;
                client?.dispose();
                channel.close();
            }
        };
        void drive();
        return channel.drain();
    }

    return {
        run,
        resolveApproval(toolCallId, approved) {
            resolveActive?.(toolCallId, approved);
        },
    };
}

/** One tool-free completion, used for compaction summaries. */
export async function completeText(
    input: { provider: ResolvedProvider; system: string; prompt: string; threadId: string; signal?: AbortSignal },
    options: AgentRunnerOptions = {},
): Promise<{ text: string; usage?: TokenUsage }> {
    let sessionExpired = false;
    const adapter = await (options.createAdapter ?? defaultCreateAdapter)(input.provider, {
        onSessionExpired: () => {
            sessionExpired = true;
        },
    });
    const result = await chat({
        adapter,
        messages: [{ role: 'user', content: input.prompt }],
        systemPrompts: [input.system],
        threadId: input.threadId,
        stream: false,
        abortController: linkedAbortController(input.signal),
    }).catch(error => {
        throw sessionExpired ? new Error(SESSION_EXPIRED_ERROR) : error;
    });
    const finished = result.chunks.filter(chunk => chunk.type === 'RUN_FINISHED');
    const last = finished[finished.length - 1];
    const usage = last && last.type === 'RUN_FINISHED' ? toTokenUsage(last.usage) : undefined;
    return { text: result.text.trim(), ...(usage ? { usage } : {}) };
}
