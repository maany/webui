import { QueryClient } from '@tanstack/react-query';
import { FEATURE_REGISTRY, FeatureFlagMap, FeatureKey } from '@/lib/core/entity/feature-config';
import { Role } from '@/lib/core/entity/auth-models';
import type { AssistantDataHandleStorePort } from '@/lib/core/port/secondary/assistant-data-handle-store-port';
import type { ToolExecutionContext } from '@/lib/infrastructure/assistant/tool-types';
import { FakePageActionRegistry } from './fake-page-action-registry';

export function allFlags(value = true): FeatureFlagMap {
    return Object.fromEntries((Object.keys(FEATURE_REGISTRY) as FeatureKey[]).map(key => [key, value])) as FeatureFlagMap;
}

export function makeTestToolContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
    return {
        signal: new AbortController().signal,
        conversationId: 'conv-1',
        turnId: 'turn-1',
        toolCallId: 'call-1',
        accountKey: 'jdoe@def',
        handles: {} as AssistantDataHandleStorePort,
        pages: new FakePageActionRegistry(),
        navigate: jest.fn(),
        queryClient: new QueryClient(),
        emit: jest.fn(),
        flags: allFlags(),
        role: Role.USER,
        ...overrides,
    };
}
