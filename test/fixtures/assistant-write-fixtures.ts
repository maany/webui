import { QueryClient } from '@tanstack/react-query';
import { FEATURE_REGISTRY, type FeatureFlagMap, type FeatureKey } from '@/lib/core/entity/feature-config';
import type { ToolExecutionContext } from '@/lib/infrastructure/assistant/tool-types';
import { makeNoopHandles, makePages } from 'test/fixtures/assistant-fixtures';

export const ALL_FEATURE_KEYS = Object.keys(FEATURE_REGISTRY) as FeatureKey[];

/** Named flagsOn (not flagMap) so it is not confused with phase 1b's flagMap(overrides) in test/fixtures/assistant-flags.ts. */
export function flagsOn(on: readonly FeatureKey[]): FeatureFlagMap {
    const map = {} as FeatureFlagMap;
    ALL_FEATURE_KEYS.forEach(key => {
        map[key] = on.includes(key);
    });
    return map;
}

export const ALL_FLAGS_ON: FeatureFlagMap = flagsOn(ALL_FEATURE_KEYS);

export function flagsWithout(...off: FeatureKey[]): FeatureFlagMap {
    return flagsOn(ALL_FEATURE_KEYS.filter(key => !off.includes(key)));
}

export function makeToolContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
    return {
        signal: new AbortController().signal,
        conversationId: 'conv-1',
        turnId: 'turn-1',
        toolCallId: 'call_1',
        accountKey: 'jdoe@def',
        handles: makeNoopHandles(),
        pages: makePages(),
        navigate: jest.fn(),
        queryClient: new QueryClient(),
        emit: jest.fn(),
        ...overrides,
    };
}

/** One valid argument object per write tool, keyed by tool name. */
export const SAMPLE_WRITE_ARGS: Record<string, Record<string, unknown>> = {
    add_account_attribute: { account: 'jdoe', key: 'country', value: 'CH' },
    add_account_identity: {
        account: 'jdoe',
        identity: 'jdoe',
        authType: 'USERPASS',
        email: 'jdoe@example.org',
        password: 's3cret-Pass',
        isDefault: true,
    },
    add_did: { scope: 'user.jdoe', name: 'my.dataset', type: 'Dataset' },
    attach_dids: {
        scope: 'user.jdoe',
        name: 'my.dataset',
        dids: [
            { scope: 'user.jdoe', name: 'f1' },
            { scope: 'user.jdoe', name: 'f2' },
            { scope: 'user.jdoe', name: 'f3' },
        ],
    },
    create_account: { account: 'jdoe', accountType: 'USER', email: 'jdoe@example.org' },
    create_rule: { dids: [{ scope: 'data18', name: 'XYZ' }], copies: 2, rse_expression: 'tier=1', lifetime_days: 30 },
    declare_bad_replicas: { dids: [{ scope: 'user.jdoe', name: 'f1' }], rse: 'CERN-PROD', reason: 'checksum mismatch' },
    delete_account: { account: 'jdoe' },
    delete_account_attribute: { account: 'jdoe', key: 'country' },
    delete_account_identity: { account: 'jdoe', identity: '/DC=ch/DC=cern/CN=jdoe', authType: 'X509' },
    delete_account_limit: { account: 'jdoe', locality: 'local', rseExpression: 'CERN-PROD' },
    set_account_limit: { account: 'jdoe', locality: 'global', rseExpression: 'tier=1', bytes: 10_000_000_000_000 },
    set_did_status: { scope: 'user.jdoe', name: 'my.dataset', open: false },
    update_account: { account: 'jdoe', options: { status: 'SUSPENDED' } },
    update_account_attribute: { account: 'jdoe', key: 'country', value: 'DE' },
    update_rule: { ruleId: 'abc123', options: { approve: true } },
};
