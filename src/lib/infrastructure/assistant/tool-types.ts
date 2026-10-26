import type { QueryClient } from '@tanstack/react-query';
import type { Role } from '@/lib/core/entity/auth-models';
import type { AssistantEvent } from '@/lib/core/entity/assistant/events';
import type { FeatureFlagMap } from '@/lib/core/entity/feature-config';
import type { ToolError, ToolSpec } from '@/lib/core/entity/assistant/tool';
import type { AssistantDataHandleStorePort } from '@/lib/core/port/secondary/assistant-data-handle-store-port';
import type { AssistantPageActionRegistryPort } from '@/lib/core/port/secondary/assistant-page-action-registry-port';
import type { AssistantSkillSourcePort } from '@/lib/core/port/secondary/assistant-skill-source-port';

export interface ToolExecutionContext {
    signal: AbortSignal;
    conversationId: string;
    turnId: string;
    toolCallId: string;
    accountKey: string;
    handles: AssistantDataHandleStorePort;
    pages: AssistantPageActionRegistryPort;
    navigate(url: string): void;
    queryClient: QueryClient;
    emit(event: AssistantEvent): void;
    /** Live feature flags; missing means every flag reads as off. */
    flags?: FeatureFlagMap;
    /** Role of the signed-in user. */
    role?: Role;
    /** The panel's mobile minimize() (bubble) API. */
    minimizePanel?: () => void;
    /** Skill source (phase 5). */
    skills?: AssistantSkillSourcePort;
}

export interface RegisteredTool<I = unknown> {
    spec: ToolSpec<I>;
    execute(args: I, ctx: ToolExecutionContext): Promise<unknown | ToolError>;
}

const TOOL_ERROR_CODES = new Set<string>([
    'denied_by_policy',
    'rejected_by_user',
    'session_expired',
    'unauthorized',
    'forbidden',
    'not_found',
    'invalid_args',
    'timeout',
    'aborted',
    'stream_error',
    'rucio_error',
    'unavailable',
]);

export function isToolError(value: unknown): value is ToolError {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as { error?: unknown; message?: unknown };
    return typeof candidate.error === 'string' && TOOL_ERROR_CODES.has(candidate.error) && typeof candidate.message === 'string';
}
