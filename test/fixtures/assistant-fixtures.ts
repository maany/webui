import { z } from 'zod';
import type { ChatMessage, Conversation } from '@/lib/core/entity/assistant/conversation';
import type { ToolRisk, ToolSpec } from '@/lib/core/entity/assistant/tool';
import { EMPTY_USAGE_TOTALS } from '@/lib/core/entity/assistant/usage';
import type { AssistantDataHandleStorePort } from '@/lib/core/port/secondary/assistant-data-handle-store-port';
import type { AssistantPageActionRegistryPort } from '@/lib/core/port/secondary/assistant-page-action-registry-port';
import type { RunnerUpdate } from '@/lib/infrastructure/assistant/tanstack-agent-runner';
import type { RegisteredTool, ToolExecutionContext } from '@/lib/infrastructure/assistant/tool-types';

export function makeSpec<I>(name: string, risk: ToolRisk, input: z.ZodType<I>): ToolSpec<I> {
    return {
        name,
        domain: 'core',
        description: `Test tool ${name}`,
        input,
        risk,
        requires: { flags: [] },
        executor: 'meta',
        output: 'object',
        describeCall: () => `Run ${name}`,
    };
}

export function makeTool<I>(name: string, risk: ToolRisk, input: z.ZodType<I>, execute: RegisteredTool<I>['execute']): RegisteredTool<I> {
    return { spec: makeSpec(name, risk, input), execute };
}

export function makeUserMessage(text: string, conversationId = 'conv-1'): ChatMessage {
    return { id: `user-${text}`, conversationId, role: 'user', parts: [{ type: 'text', text }], createdAt: '2026-10-25T10:00:00.000Z' };
}

export function makeConversation(id: string, accountKey: string, updatedAt = '2026-10-25T10:00:00.000Z'): Conversation {
    return {
        id,
        accountKey,
        title: `Conversation ${id}`,
        createdAt: updatedAt,
        updatedAt,
        providerId: 'operator',
        model: 'fake-model',
        usage: EMPTY_USAGE_TOTALS,
        conversationAllow: [],
        handles: [],
    };
}

export function makeNoopHandles(): AssistantDataHandleStorePort {
    return {
        ingestRows: jest.fn(),
        query: jest.fn(),
        listHandles: () => [],
        drop: jest.fn().mockResolvedValue(undefined),
        dropAll: jest.fn().mockResolvedValue(undefined),
        memoryBytes: jest.fn().mockResolvedValue(0),
        terminate: jest.fn().mockResolvedValue(undefined),
    };
}

export function makePages(): AssistantPageActionRegistryPort {
    return {
        register: () => () => undefined,
        setDescriber: jest.fn(),
        describe: () => undefined,
        list: () => [],
        invoke: jest.fn(),
        waitForActions: jest.fn().mockResolvedValue([]),
    };
}

export function makeToolContextFactory(signal: AbortSignal) {
    return (toolCallId: string, turnId: string): ToolExecutionContext => ({
        signal,
        conversationId: 'conv-1',
        turnId,
        toolCallId,
        accountKey: 'root@def',
        handles: makeNoopHandles(),
        pages: makePages(),
        navigate: jest.fn(),
        queryClient: {} as ToolExecutionContext['queryClient'],
        emit: jest.fn(),
    });
}

/** Collects every update; calls onUpdate first so a test can react (for example approve). */
export async function collectUpdates(updates: AsyncIterable<RunnerUpdate>, onUpdate?: (update: RunnerUpdate) => void): Promise<RunnerUpdate[]> {
    const seen: RunnerUpdate[] = [];
    for await (const update of updates) {
        onUpdate?.(update);
        seen.push(update);
    }
    return seen;
}

export function textOf(updates: RunnerUpdate[], type: 'text-delta' | 'reasoning-delta' = 'text-delta'): string {
    return updates.map(update => (update.type === type ? update.text : '')).join('');
}
