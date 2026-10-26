import { ROOT_CONTEXT, SpanStatusCode, trace, type Attributes, type Span, type Tracer } from '@opentelemetry/api';
import { BatchSpanProcessor, SimpleSpanProcessor, TracerProvider, type SpanExporter, type SpanProcessor } from '@opentelemetry/sdk-trace';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_DB_QUERY_TEXT, ATTR_DB_SYSTEM_NAME, ATTR_ERROR_TYPE, ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import type { AssistantEvent } from '@/lib/core/entity/assistant/events';
import type { TelemetryContentLevel } from '@/lib/core/entity/assistant/assistant-config';
import * as A from '@/lib/infrastructure/assistant/telemetry-attributes';
import { REDACTED, ScrubbingSpanProcessor } from '@/lib/infrastructure/assistant/telemetry-scrubber';
import type { OtlpTarget } from '@/lib/infrastructure/assistant/telemetry-sinks';

export const TELEMETRY_TRACER_NAME = 'rucio-webui-assistant';
export const TELEMETRY_SERVICE_NAME = 'rucio-webui';
export const TELEMETRY_AGENT_NAME = 'Rucio bot';
export const TELEMETRY_TRACE_NAME = 'Rucio bot turn';
export const TELEMETRY_CONTENT_MAX_CHARS = 8000;
export const TELEMETRY_ATTRIBUTE_VALUE_LIMIT = 16384;
export const TELEMETRY_EXPORT_TIMEOUT_MS = 10000;
export const USER_SINK_EXPORT_DELAY_MS = 5000;
export const OPERATOR_SINK_EXPORT_DELAY_MS = 10000;
export const TELEMETRY_MAX_EXPORT_BATCH = 64;

/**
 * Who the trace belongs to: `account@vo`. The browser never hashes it; the operator relay
 * replaces it with a salted HMAC when the operator asks for hashing (Task 7).
 */
export interface TelemetryIdentity {
    userId(): string | undefined;
}

export interface TelemetryMapperOptions {
    tracer: Tracer;
    /** Effective level, read per event so a lowered cap applies to the next span. */
    contentLevel(): TelemetryContentLevel;
    identity: TelemetryIdentity;
    /** Top-level argument keys to mask per tool (phase 4 `ToolSpec.sensitiveArgs`). */
    sensitiveArgs?(toolName: string): readonly string[];
    contentMaxChars?: number;
}

export interface TelemetryMapper {
    handle(event: AssistantEvent): void;
    /** Ends every open span (shutdown, account switch). */
    endAll(at: number): void;
}

interface TurnState {
    span: Span;
    conversationId: string;
    providerKind: string;
    model: string;
    /** End of the last LLM step or tool call; start of the next LLM span. */
    boundary: number;
    lastOutput?: string;
}

interface ToolState {
    span: Span;
    turnId: string;
}

export function truncateContent(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}...[truncated ${text.length - max} chars]` : text;
}

/** Replaces the values of top-level sensitive argument keys, at every content level. */
export function maskSensitiveToolArgs(args: unknown, keys: readonly string[]): unknown {
    if (keys.length === 0 || args === null || typeof args !== 'object' || Array.isArray(args)) {
        return args;
    }
    const masked: Record<string, unknown> = { ...(args as Record<string, unknown>) };
    for (const key of keys) {
        if (key in masked) {
            masked[key] = REDACTED;
        }
    }
    return masked;
}

function stringify(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return '[unserializable]';
    }
}

export function createTelemetryMapper(options: TelemetryMapperOptions): TelemetryMapper {
    const max = options.contentMaxChars ?? TELEMETRY_CONTENT_MAX_CHARS;
    const turns = new Map<string, TurnState>();
    const turnByConversation = new Map<string, string>();
    const tools = new Map<string, ToolState>();

    const isFull = () => options.contentLevel() === 'full';
    const content = (value: unknown): string | undefined =>
        isFull() && value !== undefined && value !== '' ? truncateContent(stringify(value), max) : undefined;
    const childOf = (parent: Span, name: string, startTime: number, attributes: Attributes): Span =>
        options.tracer.startSpan(name, { startTime, attributes }, trace.setSpan(ROOT_CONTEXT, parent));

    const markError = (span: Span, code: string, message: string) => {
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        span.setAttribute(ATTR_ERROR_TYPE, code);
        span.setAttribute(A.ATTR_LANGFUSE_OBSERVATION_LEVEL, 'ERROR');
        span.setAttribute(A.ATTR_LANGFUSE_OBSERVATION_STATUS_MESSAGE, message);
    };

    const setUser = (span: Span) => {
        const userId = options.identity.userId();
        if (userId) {
            span.setAttribute(A.ATTR_USER_ID, userId);
            span.setAttribute(A.ATTR_LANGFUSE_USER_ID, userId);
        }
    };

    const endToolsOfTurn = (turnId: string, at: number, reason: string) => {
        for (const [toolCallId, tool] of tools) {
            if (tool.turnId === turnId) {
                markError(tool.span, reason, reason);
                tool.span.end(at);
                tools.delete(toolCallId);
            }
        }
    };

    function handleEvent(event: AssistantEvent): void {
        switch (event.type) {
            case 'turn-started': {
                if (turns.has(event.turnId)) {
                    return;
                }
                const attributes: Attributes = {
                    [A.ATTR_GEN_AI_OPERATION_NAME]: A.GEN_AI_OPERATION_INVOKE_AGENT,
                    [A.ATTR_GEN_AI_AGENT_NAME]: TELEMETRY_AGENT_NAME,
                    [A.ATTR_GEN_AI_PROVIDER_NAME]: event.providerKind,
                    [A.ATTR_GEN_AI_CONVERSATION_ID]: event.conversationId,
                    [A.ATTR_SESSION_ID]: event.conversationId,
                    [A.ATTR_LANGFUSE_SESSION_ID]: event.conversationId,
                    [A.ATTR_LANGFUSE_TRACE_NAME]: TELEMETRY_TRACE_NAME,
                    [A.ATTR_LANGFUSE_TRACE_TAGS]: ['rucio-bot', event.providerKind],
                    [A.ATTR_LANGFUSE_OBSERVATION_TYPE]: 'agent',
                    [A.ATTR_RUCIO_MODEL]: event.model,
                    [A.ATTR_RUCIO_TURN_ID]: event.turnId,
                    [A.ATTR_RUCIO_CONTENT_LEVEL]: options.contentLevel(),
                };
                const input = content(event.userText);
                if (input !== undefined) {
                    attributes[A.ATTR_LANGFUSE_TRACE_INPUT] = input;
                    attributes[A.ATTR_LANGFUSE_OBSERVATION_INPUT] = input;
                }
                const span = options.tracer.startSpan(
                    `${A.GEN_AI_OPERATION_INVOKE_AGENT} ${TELEMETRY_AGENT_NAME}`,
                    { startTime: event.at, attributes },
                    ROOT_CONTEXT,
                );
                turns.set(event.turnId, {
                    span,
                    conversationId: event.conversationId,
                    providerKind: event.providerKind,
                    model: event.model,
                    boundary: event.at,
                });
                turnByConversation.set(event.conversationId, event.turnId);
                return;
            }
            case 'llm-call-finished': {
                const turn = turns.get(event.turnId);
                if (!turn) {
                    return;
                }
                const start = event.usage.durationMs > 0 ? Math.max(turn.boundary, event.at - event.usage.durationMs) : turn.boundary;
                const attributes: Attributes = {
                    [A.ATTR_GEN_AI_OPERATION_NAME]: A.GEN_AI_OPERATION_CHAT,
                    [A.ATTR_GEN_AI_PROVIDER_NAME]: turn.providerKind,
                    [A.ATTR_GEN_AI_REQUEST_MODEL]: turn.model,
                    [A.ATTR_GEN_AI_USAGE_INPUT_TOKENS]: event.usage.inputTokens,
                    [A.ATTR_GEN_AI_USAGE_OUTPUT_TOKENS]: event.usage.outputTokens,
                    [A.ATTR_LANGFUSE_OBSERVATION_TYPE]: 'generation',
                };
                if (event.usage.cachedInputTokens !== undefined) {
                    attributes[A.ATTR_GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS] = event.usage.cachedInputTokens;
                }
                if (event.finishReason) {
                    attributes[A.ATTR_GEN_AI_RESPONSE_FINISH_REASONS] = [event.finishReason];
                }
                if (event.usage.costUSD !== null) {
                    attributes[A.ATTR_LANGFUSE_OBSERVATION_COST_DETAILS] = JSON.stringify({ total: event.usage.costUSD });
                }
                const output = content(event.outputText);
                if (output !== undefined) {
                    attributes[A.ATTR_LANGFUSE_OBSERVATION_OUTPUT] = output;
                    turn.lastOutput = output;
                }
                const span = childOf(turn.span, `${A.GEN_AI_OPERATION_CHAT} ${turn.model}`, start, attributes);
                span.end(event.at);
                turn.boundary = event.at;
                return;
            }
            case 'tool-call-started': {
                const turn = turns.get(event.turnId);
                if (!turn || tools.has(event.toolCallId)) {
                    return;
                }
                const attributes: Attributes = {
                    [A.ATTR_GEN_AI_OPERATION_NAME]: A.GEN_AI_OPERATION_EXECUTE_TOOL,
                    [A.ATTR_GEN_AI_TOOL_NAME]: event.toolName,
                    [A.ATTR_GEN_AI_TOOL_CALL_ID]: event.toolCallId,
                    [A.ATTR_GEN_AI_TOOL_TYPE]: 'function',
                    [A.ATTR_LANGFUSE_OBSERVATION_TYPE]: 'tool',
                    [A.ATTR_RUCIO_TOOL_POLICY]: event.policy,
                };
                const args = content(maskSensitiveToolArgs(event.args, options.sensitiveArgs?.(event.toolName) ?? []));
                if (args !== undefined) {
                    attributes[A.ATTR_GEN_AI_TOOL_CALL_ARGUMENTS] = args;
                    attributes[A.ATTR_LANGFUSE_OBSERVATION_INPUT] = args;
                }
                const span = childOf(turn.span, `${A.GEN_AI_OPERATION_EXECUTE_TOOL} ${event.toolName}`, event.at, attributes);
                tools.set(event.toolCallId, { span, turnId: event.turnId });
                return;
            }
            case 'tool-approval': {
                const target = tools.get(event.toolCallId)?.span ?? turns.get(event.turnId)?.span;
                if (!target) {
                    return;
                }
                const attributes: Attributes = {
                    [A.ATTR_RUCIO_APPROVAL_DECISION]: event.decision,
                    [A.ATTR_RUCIO_APPROVAL_SCOPE]: event.scope,
                    [A.ATTR_RUCIO_APPROVAL_APPROVER]: event.approver,
                };
                target.addEvent('tool.approval', attributes, event.at);
                target.setAttributes(attributes);
                return;
            }
            case 'tool-call-finished': {
                const tool = tools.get(event.toolCallId);
                if (!tool) {
                    return;
                }
                tool.span.setAttribute(A.ATTR_RUCIO_DURATION_MS, event.durationMs);
                const result = content(event.resultSummary);
                if (result !== undefined) {
                    tool.span.setAttribute(A.ATTR_GEN_AI_TOOL_CALL_RESULT, result);
                    tool.span.setAttribute(A.ATTR_LANGFUSE_OBSERVATION_OUTPUT, result);
                }
                if (event.error) {
                    markError(tool.span, event.error.error, isFull() ? `${event.error.error}: ${event.error.message}` : event.error.error);
                }
                tool.span.end(event.at);
                tools.delete(event.toolCallId);
                const turn = turns.get(tool.turnId);
                if (turn) {
                    turn.boundary = Math.max(turn.boundary, event.at);
                }
                return;
            }
            case 'sql-executed': {
                const parent = tools.get(event.toolCallId)?.span ?? turns.get(event.turnId)?.span;
                if (!parent) {
                    return;
                }
                const attributes: Attributes = {
                    [ATTR_DB_SYSTEM_NAME]: 'duckdb',
                    [A.ATTR_GEN_AI_TOOL_CALL_ID]: event.toolCallId,
                    [A.ATTR_RUCIO_SQL_TOTAL_ROWS]: event.totalRows,
                    [A.ATTR_RUCIO_DURATION_MS]: event.durationMs,
                    [A.ATTR_LANGFUSE_OBSERVATION_TYPE]: 'span',
                };
                const sql = content(event.sql);
                if (sql !== undefined) {
                    attributes[ATTR_DB_QUERY_TEXT] = sql;
                    attributes[A.ATTR_LANGFUSE_OBSERVATION_INPUT] = sql;
                }
                const span = childOf(parent, 'duckdb query', event.at - event.durationMs, attributes);
                span.end(event.at);
                return;
            }
            case 'skill-activated': {
                const turn = turns.get(event.turnId);
                if (!turn) {
                    return;
                }
                const span = childOf(turn.span, `skill ${event.name}`, event.at, {
                    [A.ATTR_RUCIO_SKILL_NAME]: event.name,
                    [A.ATTR_RUCIO_SKILL_SOURCE]: event.source,
                    [A.ATTR_LANGFUSE_OBSERVATION_TYPE]: 'event',
                });
                span.end(event.at);
                return;
            }
            case 'compaction': {
                const turnId = turnByConversation.get(event.conversationId);
                const turn = turnId ? turns.get(turnId) : undefined;
                const attributes: Attributes = {
                    [A.ATTR_RUCIO_COMPACTION_UP_TO]: event.upToMessageId,
                    [A.ATTR_LANGFUSE_OBSERVATION_TYPE]: 'span',
                };
                if (turn) {
                    childOf(turn.span, 'compaction', event.at, attributes).end(event.at);
                    return;
                }
                const span = options.tracer.startSpan(
                    'compaction',
                    {
                        startTime: event.at,
                        attributes: {
                            ...attributes,
                            [A.ATTR_SESSION_ID]: event.conversationId,
                            [A.ATTR_LANGFUSE_SESSION_ID]: event.conversationId,
                            [A.ATTR_GEN_AI_CONVERSATION_ID]: event.conversationId,
                        },
                    },
                    ROOT_CONTEXT,
                );
                setUser(span);
                span.end(event.at);
                return;
            }
            case 'turn-finished': {
                const turn = turns.get(event.turnId);
                if (!turn) {
                    return;
                }
                endToolsOfTurn(event.turnId, event.at, 'unfinished');
                turn.span.setAttributes({
                    [A.ATTR_RUCIO_TURN_STATUS]: event.status,
                    [A.ATTR_RUCIO_INPUT_TOKENS]: event.usage.inputTokens,
                    [A.ATTR_RUCIO_OUTPUT_TOKENS]: event.usage.outputTokens,
                    [A.ATTR_RUCIO_DURATION_MS]: event.usage.durationMs,
                });
                if (event.usage.cachedInputTokens !== undefined) {
                    turn.span.setAttribute(A.ATTR_RUCIO_CACHED_INPUT_TOKENS, event.usage.cachedInputTokens);
                }
                if (event.usage.costUSD !== null) {
                    turn.span.setAttribute(A.ATTR_RUCIO_COST_USD, event.usage.costUSD);
                }
                if (turn.lastOutput !== undefined && isFull()) {
                    turn.span.setAttribute(A.ATTR_LANGFUSE_TRACE_OUTPUT, turn.lastOutput);
                    turn.span.setAttribute(A.ATTR_LANGFUSE_OBSERVATION_OUTPUT, turn.lastOutput);
                }
                setUser(turn.span);
                if (event.status === 'error') {
                    markError(turn.span, 'turn_error', isFull() && event.error ? event.error : 'turn_error');
                } else if (event.status !== 'completed') {
                    turn.span.setAttribute(A.ATTR_LANGFUSE_OBSERVATION_LEVEL, 'WARNING');
                    turn.span.setAttribute(A.ATTR_LANGFUSE_OBSERVATION_STATUS_MESSAGE, event.status);
                }
                turn.span.end(event.at);
                turns.delete(event.turnId);
                if (turnByConversation.get(turn.conversationId) === event.turnId) {
                    turnByConversation.delete(turn.conversationId);
                }
                return;
            }
        }
    }

    /** Malformed or out-of-order events are dropped; the mapper never throws into the caller. */
    function handle(event: AssistantEvent): void {
        try {
            handleEvent(event);
        } catch {
            // Telemetry must never break a chat turn.
        }
    }

    function endAll(at: number): void {
        for (const [turnId, turn] of turns) {
            endToolsOfTurn(turnId, at, 'aborted');
            turn.span.setAttribute(A.ATTR_RUCIO_TURN_STATUS, 'aborted');
            setUser(turn.span);
            markError(turn.span, 'aborted', 'aborted');
            turn.span.end(at);
        }
        turns.clear();
        turnByConversation.clear();
        for (const tool of tools.values()) {
            tool.span.end(at);
        }
        tools.clear();
    }

    return { handle, endAll };
}

export interface StartAssistantTelemetryOptions {
    userSink?: OtlpTarget;
    operatorSink?: OtlpTarget;
    contentLevel(): TelemetryContentLevel;
    identity: TelemetryIdentity;
    /** Runtime secrets (API keys, sink keys) scrubbed verbatim from every span. */
    secrets(): readonly string[];
    /** Top-level argument keys to mask per tool (phase 4 `ToolSpec.sensitiveArgs`). */
    sensitiveArgs?(toolName: string): readonly string[];
    /** Tests: export synchronously to these exporters instead of the OTLP sinks. */
    exporters?: SpanExporter[];
}

export interface AssistantTelemetry {
    handle(event: AssistantEvent): void;
    forceFlush(): Promise<void>;
    shutdown(): Promise<void>;
}

function otlpProcessor(target: OtlpTarget, scheduledDelayMillis: number): SpanProcessor {
    const exporter = new OTLPTraceExporter({ url: target.url, headers: target.headers, timeoutMillis: TELEMETRY_EXPORT_TIMEOUT_MS });
    return new BatchSpanProcessor({ exporter, scheduledDelayMillis, maxExportBatchSize: TELEMETRY_MAX_EXPORT_BATCH });
}

/**
 * Builds a private TracerProvider (never registered globally, so libraries that look for a
 * global tracer stay silent) with one scrubbed processor per sink, and maps events to spans.
 */
export function startAssistantTelemetry(options: StartAssistantTelemetryOptions): AssistantTelemetry {
    const inner: SpanProcessor[] = options.exporters
        ? options.exporters.map(exporter => new SimpleSpanProcessor({ exporter }))
        : [
              ...(options.userSink ? [otlpProcessor(options.userSink, USER_SINK_EXPORT_DELAY_MS)] : []),
              ...(options.operatorSink ? [otlpProcessor(options.operatorSink, OPERATOR_SINK_EXPORT_DELAY_MS)] : []),
          ];
    const provider = new TracerProvider({
        resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: TELEMETRY_SERVICE_NAME }),
        spanLimits: { attributeValueLengthLimit: TELEMETRY_ATTRIBUTE_VALUE_LIMIT },
        spanProcessors: inner.map(processor => new ScrubbingSpanProcessor(processor, options.secrets)),
    });
    const mapper = createTelemetryMapper({
        tracer: provider.getTracer(TELEMETRY_TRACER_NAME),
        contentLevel: options.contentLevel,
        identity: options.identity,
        sensitiveArgs: options.sensitiveArgs,
    });
    let stopped = false;
    return {
        handle(event) {
            if (stopped) {
                return;
            }
            try {
                mapper.handle(event);
            } catch {
                // Telemetry must never break a chat turn.
            }
        },
        forceFlush: () => provider.forceFlush(),
        async shutdown() {
            if (stopped) {
                return;
            }
            stopped = true;
            mapper.endAll(Date.now());
            await provider.shutdown();
        },
    };
}
