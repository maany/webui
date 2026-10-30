import { z } from 'zod';
import { DIDType, RuleState } from '@/lib/core/entity/rucio';
import {
    DidsSearchSchema,
    didsSearchTarget,
    RsesFilterSchema,
    rsesFilterTarget,
    RulesFilterSchema,
    rulesFilterTarget,
    SubscriptionsFilterSchema,
    subscriptionsFilterTarget,
} from '@/lib/infrastructure/assistant/page-actions/list-actions';

describe('list page actions', () => {
    it('builds a DID search', () => {
        const target = didsSearchTarget(DidsSearchSchema.parse({ scope: 'user.jdoe', name: 'data*', type: 'dataset' }));
        expect(target).toMatchObject({
            url: '/dids?autoSearch=true&scope=user.jdoe&name=data*&type=Dataset',
            pattern: 'user.jdoe:data*',
            type: DIDType.DATASET,
        });
        expect(didsSearchTarget(DidsSearchSchema.parse({ scope: 'user.jdoe', name: '*' })).type).toBe(DIDType.ALL);
        expect(DidsSearchSchema.safeParse({ scope: 'user.jdoe:x', name: '*' }).success).toBe(false);
    });

    it('builds rule filters with the page defaults', () => {
        const target = rulesFilterTarget(RulesFilterSchema.parse({ account: 'jdoe', state: 'Stuck', updatedAfter: '2026-01-02' }));
        expect(target.url).toBe('/rules?autoSearch=true&account=jdoe&state=Stuck&updated_after=2026-01-02');
        expect(target.filters).toMatchObject({ account: 'jdoe', scope: '*', name: '', activity: '', state: RuleState.STUCK });
        expect(target.filters.updatedAfter?.getDate()).toBe(2);
        expect(target.summary).toContain('state Stuck');
        expect(RulesFilterSchema.safeParse({}).success).toBe(false);
        expect(RulesFilterSchema.safeParse({ state: 'Broken' }).success).toBe(false);
    });

    it('builds an RSE search', () => {
        expect(rsesFilterTarget(RsesFilterSchema.parse({ expression: 'tier=1&type=DISK' }))).toMatchObject({
            url: '/rses?expression=tier%3D1%26type%3DDISK&autoSearch=true',
            expression: 'tier=1&type=DISK',
        });
        expect(RsesFilterSchema.safeParse({ expression: '' }).success).toBe(false);
    });

    it('builds a subscription search for valid account names only', () => {
        expect(subscriptionsFilterTarget(SubscriptionsFilterSchema.parse({ account: 'jdoe' }))).toMatchObject({
            url: '/subscriptions?account=jdoe&autoSearch=true',
            account: 'jdoe',
        });
        expect(SubscriptionsFilterSchema.safeParse({ account: 'Not Valid!' }).success).toBe(false);
    });

    it('has schemas that convert to JSON schema and summaries without em dashes', () => {
        [DidsSearchSchema, RulesFilterSchema, RsesFilterSchema, SubscriptionsFilterSchema].forEach(schema =>
            expect(() => z.toJSONSchema(schema)).not.toThrow(),
        );
        const summaries = [
            didsSearchTarget({ scope: 'a', name: 'b' }).summary,
            rulesFilterTarget({ account: 'jdoe' }).summary,
            rsesFilterTarget({ expression: '*' }).summary,
            subscriptionsFilterTarget({ account: 'jdoe' }).summary,
        ];
        summaries.forEach(summary => expect(summary).not.toContain('\u2014'));
    });

    it('caps string lengths like the navigate params', () => {
        const long = 'x'.repeat(256);
        expect(DidsSearchSchema.safeParse({ scope: long, name: '*' }).success).toBe(false);
        expect(RulesFilterSchema.safeParse({ account: long }).success).toBe(false);
        expect(RsesFilterSchema.safeParse({ expression: 'x'.repeat(1001) }).success).toBe(false);
        expect(RsesFilterSchema.safeParse({ expression: 'x'.repeat(1000) }).success).toBe(true);
        expect(SubscriptionsFilterSchema.safeParse({ account: long }).success).toBe(false);
    });
});
