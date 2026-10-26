import {
    describeAccountPage,
    describeDIDPage,
    describeRSEPage,
    describeRulePage,
    describeSubscriptionPage,
} from '@/lib/infrastructure/assistant/page-summaries';
import {
    AccountStatus,
    AccountType,
    DIDAvailability,
    DIDType,
    RSEType,
    RuleGrouping,
    RuleNotification,
    RuleState,
    SubscriptionState,
} from '@/lib/core/entity/rucio';
import { DIDMetaViewModel } from '@/lib/infrastructure/data/view-model/did';
import { RuleMetaViewModel } from '@/lib/infrastructure/data/view-model/rule';
import { RSEDetailsViewModel } from '@/lib/infrastructure/data/view-model/rse';
import { SubscriptionViewModel } from '@/lib/infrastructure/data/view-model/subscriptions';

const didMeta: DIDMetaViewModel = {
    status: 'success',
    name: 'dataset1',
    scope: 'user.jdoe',
    account: 'jdoe',
    did_type: DIDType.DATASET,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    availability: DIDAvailability.AVAILABLE,
    obsolete: false,
    hidden: false,
    suppressed: false,
    purge_replicas: true,
    monotonic: false,
    is_open: false,
    adler32: null,
    md5: null,
    guid: null,
    bytes: 2048,
};

const ruleMeta: RuleMetaViewModel = {
    status: 'success',
    account: 'jdoe',
    activity: 'User Subscriptions',
    copies: 2,
    created_at: '2026-01-01T00:00:00Z',
    did_type: DIDType.DATASET,
    expires_at: null,
    grouping: RuleGrouping.DATASET,
    id: 'abc123',
    ignore_account_limit: false,
    ignore_availability: false,
    locked: false,
    locks_ok_cnt: 3,
    locks_replicating_cnt: 1,
    locks_stuck_cnt: 2,
    name: 'dataset1',
    notification: RuleNotification.No,
    priority: 3,
    purge_replicas: false,
    rse_expression: 'tier=1',
    scope: 'user.jdoe',
    split_container: false,
    state: RuleState.STUCK,
    updated_at: '2026-01-02T00:00:00Z',
    comments: null,
};

const rseMeta = {
    status: 'success',
    id: '1',
    name: 'CERN-PROD',
    rse_type: RSEType.DISK,
    volatile: false,
    deterministic: true,
    staging_area: false,
    availability_delete: true,
    availability_read: true,
    availability_write: false,
    protocols: [{}, {}],
} as unknown as RSEDetailsViewModel;

const subscription: SubscriptionViewModel = {
    status: 'success',
    account: 'jdoe',
    created_at: '2026-01-01T00:00:00Z',
    id: 's1',
    last_processed: '2026-01-03T00:00:00Z',
    lifetime: '2027-01-01T00:00:00Z',
    name: 'sub1',
    policyid: 0,
    retroactive: false,
    state: SubscriptionState.ACTIVE,
    updated_at: '2026-01-02T00:00:00Z',
    filter: '{"scope": ["user.jdoe"]}',
    replication_rules: '[]',
};

describe('page summaries', () => {
    it('describes a DID', () => {
        expect(describeDIDPage({ scope: 'user.jdoe', name: 'dataset1', meta: didMeta })).toBe(
            'Dataset user.jdoe:dataset1, owner jdoe, availability Available, 2048 bytes, closed, created 2026-01-01T00:00:00Z.',
        );
        expect(describeDIDPage({ scope: 'user.jdoe', name: 'dataset1' })).toBe('DID user.jdoe:dataset1, details are loading or failed to load.');
    });

    it('describes a rule', () => {
        expect(describeRulePage({ id: 'abc123', meta: ruleMeta })).toBe(
            'Rule abc123, state Stuck, DID user.jdoe:dataset1, account jdoe, RSE expression tier=1, 2 copies, ' +
                'locks OK 3, replicating 1, stuck 2, activity User Subscriptions, expires never.',
        );
        expect(describeRulePage({ id: 'abc123' })).toBe('Rule abc123, details are loading or failed to load.');
    });

    it('describes an RSE with its first attributes', () => {
        const attributes = Array.from({ length: 12 }, (_, index) => ({ key: `k${index}`, value: index }));
        const summary = describeRSEPage({ name: 'CERN-PROD', meta: rseMeta, attributes });
        expect(summary).toContain('RSE CERN-PROD, DISK, deterministic yes, volatile no, read yes, write no, delete yes, 2 protocols.');
        expect(summary).toContain('Attributes: k0=0, k1=1');
        expect(summary).toContain('k9=9');
        expect(summary).not.toContain('k10=10');
    });

    it('describes an account and counts quotas near their limit', () => {
        const info = {
            status: 'success' as const,
            account: 'jdoe',
            accountType: AccountType.USER,
            accountStatus: AccountStatus.ACTIVE,
            email: 'jdoe@example.com',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
        };
        const quotas = {
            local: [
                { rse: 'A', bytesLimit: 100, bytesUsed: 95, files: 1, bytesRemaining: 5 },
                { rse: 'B', bytesLimit: 100, bytesUsed: 10, files: 1, bytesRemaining: 90 },
            ],
            global: [{ rseExpression: 'tier=1', resolvedRses: ['A'], bytesLimit: null, bytesUsed: 5, files: 1, bytesRemaining: null }],
        };
        const summary = describeAccountPage({ account: 'jdoe', info, tab: 'quotas', quotas });
        expect(summary).toBe('Account jdoe, USER, status ACTIVE, tab quotas. 2 local and 1 global quotas, 1 at 90% or more of the limit.');
        expect(summary).not.toContain('jdoe@example.com');
        expect(describeAccountPage({ account: 'jdoe', info, tab: 'overview' })).toBe(
            'Account jdoe, USER, status ACTIVE, tab overview. Quotas not loaded.',
        );
        expect(describeAccountPage({ account: 'jdoe', tab: 'overview' })).toBe('Account jdoe, details are loading or failed to load.');
    });

    it('describes a subscription', () => {
        expect(describeSubscriptionPage({ account: 'jdoe', name: 'sub1', meta: subscription })).toBe(
            'Subscription jdoe:sub1, state A, retroactive no, policy 0, last processed 2026-01-03T00:00:00Z, ' +
                'lifetime 2027-01-01T00:00:00Z. Filter: {"scope": ["user.jdoe"]}',
        );
    });

    it('stays within 500 characters and uses no em dashes', () => {
        const long = { ...subscription, filter: 'x'.repeat(2000) };
        const summaries = [
            describeSubscriptionPage({ account: 'jdoe', name: 'sub1', meta: long }),
            describeDIDPage({ scope: 'user.jdoe', name: 'dataset1', meta: didMeta }),
            describeRulePage({ id: 'abc123', meta: ruleMeta }),
        ];
        summaries.forEach(summary => {
            expect(summary.length).toBeLessThanOrEqual(500);
            expect(summary).not.toContain('\u2014');
        });
    });
});
