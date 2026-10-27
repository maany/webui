import {
    computeNeedsApproval,
    computeOptionsErrors,
    getEmptyOptionsErrors,
    getTotalDataSize,
    hasOptionsErrors,
    isRSESufficient,
} from '@/component-library/pages/Rule/create/create-rule-validation';
import { CreateRuleGrouping, CreateRuleParameters, getEmptyCreateRuleParameters } from '@/lib/infrastructure/data/view-model/rule';
import { RSEAccountUsageLimitViewModel } from '@/lib/infrastructure/data/view-model/rse';
import { ListDIDsViewModel } from '@/lib/infrastructure/data/view-model/list-did';
import { DIDType } from '@/lib/core/entity/rucio';

const did = (name: string, bytes: number): ListDIDsViewModel => ({
    status: 'success',
    scope: 'user.jdoe',
    name,
    did_type: DIDType.FILE,
    bytes,
    length: 1,
    open: false,
});

const rse = (name: string, remaining: number, limit = 10_000, hasQuota = true): RSEAccountUsageLimitViewModel => ({
    status: 'success',
    rse: name,
    rse_id: name,
    account: 'jdoe',
    files: 0,
    used_bytes: 0,
    bytes_limit: limit,
    bytes_remaining: remaining,
    has_quota: hasQuota,
    total_expected_usage: 0,
});

const params = (overrides: Partial<CreateRuleParameters>): CreateRuleParameters => ({ ...getEmptyCreateRuleParameters(), ...overrides });

describe('create rule validation', () => {
    it('sums the DID sizes', () => {
        expect(getTotalDataSize({ dids: [did('a', 100), did('b', 250)] })).toBe(350);
    });

    it('treats an RSE as sufficient with enough bytes left or an infinite quota', () => {
        expect(isRSESufficient(rse('A', 500), 400)).toBe(true);
        expect(isRSESufficient(rse('A', 300), 400)).toBe(false);
        expect(isRSESufficient(rse('A', -1, -1, true), 400)).toBe(true);
        expect(isRSESufficient(rse('A', -1, -1, false), 400)).toBe(false);
    });

    it('needs approval only when RSEs are chosen and none is sufficient', () => {
        expect(computeNeedsApproval([], 400)).toBe(false);
        expect(computeNeedsApproval([rse('A', 300), rse('B', 100)], 400)).toBe(true);
        expect(computeNeedsApproval([rse('A', 300), rse('B', 500)], 400)).toBe(false);
    });

    it('finds no errors for a valid single copy rule', () => {
        const errors = computeOptionsErrors(params({ dids: [did('a', 100)], rses: [rse('A', 500)], copies: 1 }));
        expect(errors).toEqual(getEmptyOptionsErrors());
        expect(hasOptionsErrors(errors)).toBe(false);
    });

    it('flags copies above the number of RSEs or above the sufficient RSEs', () => {
        const errors = computeOptionsErrors(params({ dids: [did('a', 100)], rses: [rse('A', 500)], copies: 2 }));
        expect(errors.copiesInvalid).toBe(true);
        expect(errors.tooManyCopies).toBe(true);
        expect(hasOptionsErrors(errors)).toBe(true);
    });

    it('skips the quota check when asking for approval but then needs a comment', () => {
        const errors = computeOptionsErrors(params({ dids: [did('a', 1000)], rses: [rse('A', 10)], copies: 1, askApproval: true }));
        expect(errors.tooManyCopies).toBe(false);
        expect(errors.commentsEmpty).toBe(true);
    });

    it('checks lifetime, grouping and sample count', () => {
        const errors = computeOptionsErrors(
            params({
                dids: [did('a', 1)],
                rses: [rse('A', 10)],
                daysLifetime: 0,
                grouping: 'Weird' as CreateRuleGrouping,
                sample: true,
                sampleFileCount: 0,
            }),
        );
        expect(errors.lifetimeInvalid).toBe(true);
        expect(errors.groupingInvalid).toBe(true);
        expect(errors.sampleCountInvalid).toBe(true);
    });
});
