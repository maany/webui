import { AddAccountAttributeSchema } from '@/lib/infrastructure/api-schemas/add-account-attribute';
import { AddAccountIdentitySchema } from '@/lib/infrastructure/api-schemas/add-account-identity';
import { AddDidSchema } from '@/lib/infrastructure/api-schemas/add-did';
import { AttachDidsSchema } from '@/lib/infrastructure/api-schemas/attach-dids';
import { CreateAccountSchema } from '@/lib/infrastructure/api-schemas/create-account';
import { CreateRuleSchema } from '@/lib/infrastructure/api-schemas/create-rule';
import { DeclareBadReplicasSchema } from '@/lib/infrastructure/api-schemas/declare-bad-replicas';
import { DeleteAccountSchema } from '@/lib/infrastructure/api-schemas/delete-account';
import { DeleteAccountAttributeSchema } from '@/lib/infrastructure/api-schemas/delete-account-attribute';
import { DeleteAccountIdentitySchema } from '@/lib/infrastructure/api-schemas/delete-account-identity';
import { DeleteAccountLimitSchema } from '@/lib/infrastructure/api-schemas/delete-account-limit';
import { SetAccountLimitSchema } from '@/lib/infrastructure/api-schemas/set-account-limit';
import { SetDidStatusSchema } from '@/lib/infrastructure/api-schemas/set-did-status';
import { UpdateAccountSchema } from '@/lib/infrastructure/api-schemas/update-account';
import { UpdateAccountAttributeSchema } from '@/lib/infrastructure/api-schemas/update-account-attribute';
import { UpdateRuleSchema } from '@/lib/infrastructure/api-schemas/update-rule';
import {
    formatDidList,
    formatLifetimeSeconds,
    plural,
    summarizeAddAccountAttribute,
    summarizeAddAccountIdentity,
    summarizeAddDid,
    summarizeAttachDids,
    summarizeCreateAccount,
    summarizeCreateRule,
    summarizeDeclareBadReplicas,
    summarizeDeleteAccount,
    summarizeDeleteAccountAttribute,
    summarizeDeleteAccountIdentity,
    summarizeDeleteAccountLimit,
    summarizeSetAccountLimit,
    summarizeSetDidStatus,
    summarizeUpdateAccount,
    summarizeUpdateAccountAttribute,
    summarizeUpdateRule,
    truncate,
} from '@/lib/infrastructure/assistant/tools/write-summaries';

const EM_DASH = String.fromCharCode(0x2014);
const did = (name: string, scope = 'user.jdoe') => ({ scope, name });

describe('summary helpers', () => {
    it('pluralizes', () => {
        expect(plural(1, 'copy', 'copies')).toBe('1 copy');
        expect(plural(2, 'copy', 'copies')).toBe('2 copies');
        expect(plural(3, 'day')).toBe('3 days');
    });

    it('lists at most two DIDs and counts the rest', () => {
        expect(formatDidList([did('a')])).toBe('user.jdoe:a');
        expect(formatDidList([did('a'), did('b')])).toBe('user.jdoe:a and user.jdoe:b');
        expect(formatDidList([did('a'), did('b'), did('c'), did('d')])).toBe('user.jdoe:a, user.jdoe:b and 2 more');
    });

    it('formats lifetimes in the largest exact unit', () => {
        expect(formatLifetimeSeconds(604800)).toBe('7 days');
        expect(formatLifetimeSeconds(7200)).toBe('2 hours');
        expect(formatLifetimeSeconds(120)).toBe('2 minutes');
        expect(formatLifetimeSeconds(90061)).toBe('90061 seconds');
    });

    it('collapses whitespace and truncates long text to one line', () => {
        expect(truncate('a\n  b')).toBe('a b');
        expect(truncate('x'.repeat(100))).toBe(`${'x'.repeat(77)}...`);
    });
});

describe('rule and DID summaries', () => {
    it('create rule, the documented example', () => {
        const args = CreateRuleSchema.parse({ dids: [did('XYZ', 'data18')], copies: 2, rse_expression: 'tier=1', lifetime_days: 30 });
        expect(summarizeCreateRule(args)).toBe('Create rule: 2 copies of data18:XYZ on tier=1, lifetime 30 days');
    });

    it('create rule with extras', () => {
        const args = CreateRuleSchema.parse({
            dids: [did('A', 'data18'), did('B', 'data18'), did('C', 'data18')],
            copies: 1,
            rse_expression: 'CERN-PROD',
            grouping: 'DATASET',
            ask_approval: true,
            comments: 'for the\nreprocessing',
        });
        expect(summarizeCreateRule(args)).toBe(
            'Create rule: 1 copy of data18:A, data18:B and 1 more on CERN-PROD, no lifetime, grouping DATASET, asks for approval, comment "for the reprocessing"',
        );
    });

    it('update rule', () => {
        expect(summarizeUpdateRule(UpdateRuleSchema.parse({ ruleId: 'abc123', options: { approve: true } }))).toBe('Update rule abc123: approve');
        expect(summarizeUpdateRule(UpdateRuleSchema.parse({ ruleId: 'abc123', options: { approve: false, comment: 'not enough quota' } }))).toBe(
            'Update rule abc123: deny, comment "not enough quota"',
        );
        expect(summarizeUpdateRule(UpdateRuleSchema.parse({ ruleId: 'abc123', options: { lifetime: 604800, priority: 4 } }))).toBe(
            'Update rule abc123: lifetime 7 days, priority 4',
        );
        expect(summarizeUpdateRule(UpdateRuleSchema.parse({ ruleId: 'abc123', options: { lifetime: null } }))).toBe(
            'Update rule abc123: remove the lifetime',
        );
    });

    it('DID writes', () => {
        expect(summarizeAddDid(AddDidSchema.parse({ scope: 'user.jdoe', name: 'my.dataset', type: 'Dataset' }))).toBe(
            'Create dataset user.jdoe:my.dataset',
        );
        expect(summarizeAttachDids(AttachDidsSchema.parse({ scope: 'user.jdoe', name: 'my.dataset', dids: [did('f1'), did('f2'), did('f3')] }))).toBe(
            'Attach 3 DIDs to user.jdoe:my.dataset: user.jdoe:f1, user.jdoe:f2 and 1 more',
        );
        expect(summarizeSetDidStatus(SetDidStatusSchema.parse({ scope: 'user.jdoe', name: 'my.dataset', open: false }))).toBe(
            'Close user.jdoe:my.dataset',
        );
        expect(summarizeSetDidStatus(SetDidStatusSchema.parse({ scope: 'user.jdoe', name: 'my.dataset', open: true }))).toBe(
            'Open user.jdoe:my.dataset',
        );
    });

    it('declare bad replicas', () => {
        expect(
            summarizeDeclareBadReplicas(DeclareBadReplicasSchema.parse({ dids: [did('f1')], rse: 'CERN-PROD', reason: 'checksum mismatch' })),
        ).toBe('Declare 1 replica bad on CERN-PROD: user.jdoe:f1. Reason: checksum mismatch');
        expect(
            summarizeDeclareBadReplicas(
                DeclareBadReplicasSchema.parse({ dids: [did('f1'), did('f2')], rse: 'CERN-PROD', reason: 'lost disk', expiresAt: '2026-11-01' }),
            ),
        ).toBe('Declare 2 replicas bad on CERN-PROD: user.jdoe:f1 and user.jdoe:f2. Reason: lost disk. Expires 2026-11-01');
    });
});

describe('account summaries', () => {
    it('create, update and delete account', () => {
        expect(summarizeCreateAccount(CreateAccountSchema.parse({ account: 'jdoe', accountType: 'USER', email: 'jdoe@example.org' }))).toBe(
            'Create user account jdoe with email jdoe@example.org',
        );
        expect(summarizeCreateAccount(CreateAccountSchema.parse({ account: 'svc', accountType: 'SERVICE', email: null }))).toBe(
            'Create service account svc without email',
        );
        expect(summarizeUpdateAccount(UpdateAccountSchema.parse({ account: 'jdoe', options: { status: 'SUSPENDED' } }))).toBe(
            'Update account jdoe: suspend',
        );
        expect(summarizeUpdateAccount(UpdateAccountSchema.parse({ account: 'jdoe', options: { status: 'ACTIVE', email: null } }))).toBe(
            'Update account jdoe: reactivate, clear email',
        );
        expect(summarizeUpdateAccount(UpdateAccountSchema.parse({ account: 'jdoe', options: { email: 'a@b.org', accountType: 'GROUP' } }))).toBe(
            'Update account jdoe: email a@b.org, type GROUP',
        );
        expect(summarizeDeleteAccount(DeleteAccountSchema.parse({ account: 'jdoe' }))).toBe('Delete account jdoe');
    });

    it('attributes', () => {
        expect(summarizeAddAccountAttribute(AddAccountAttributeSchema.parse({ account: 'jdoe', key: 'country', value: 'CH' }))).toBe(
            'Add attribute country=CH to account jdoe',
        );
        expect(summarizeUpdateAccountAttribute(UpdateAccountAttributeSchema.parse({ account: 'jdoe', key: 'country', value: 'DE' }))).toBe(
            'Set attribute country=DE on account jdoe',
        );
        expect(summarizeDeleteAccountAttribute(DeleteAccountAttributeSchema.parse({ account: 'jdoe', key: 'country' }))).toBe(
            'Delete attribute country from account jdoe',
        );
    });

    it('identities never print the password', () => {
        const summary = summarizeAddAccountIdentity(
            AddAccountIdentitySchema.parse({
                account: 'jdoe',
                identity: 'jdoe',
                authType: 'USERPASS',
                email: 'jdoe@example.org',
                password: 's3cret-Pass',
                isDefault: true,
            }),
        );
        expect(summary).toBe('Add USERPASS identity jdoe to account jdoe as default, with a password');
        expect(summary).not.toContain('s3cret');
        expect(
            summarizeDeleteAccountIdentity(
                DeleteAccountIdentitySchema.parse({ account: 'jdoe', identity: '/DC=ch/DC=cern/CN=jdoe', authType: 'X509' }),
            ),
        ).toBe('Remove X509 identity /DC=ch/DC=cern/CN=jdoe from account jdoe');
    });

    it('quotas', () => {
        expect(
            summarizeSetAccountLimit(
                SetAccountLimitSchema.parse({ account: 'jdoe', locality: 'global', rseExpression: 'tier=1', bytes: 10_000_000_000_000 }),
            ),
        ).toBe('Set global quota of account jdoe on tier=1 to 10 TB');
        expect(
            summarizeSetAccountLimit(SetAccountLimitSchema.parse({ account: 'jdoe', locality: 'local', rseExpression: 'CERN-PROD', bytes: -1 })),
        ).toBe('Set local quota of account jdoe on CERN-PROD to unlimited');
        expect(summarizeDeleteAccountLimit(DeleteAccountLimitSchema.parse({ account: 'jdoe', locality: 'local', rseExpression: 'CERN-PROD' }))).toBe(
            'Remove local quota of account jdoe on CERN-PROD',
        );
    });

    it('keeps user text on one bounded line', () => {
        const long = DeclareBadReplicasSchema.parse({ dids: [did('f1')], rse: 'CERN-PROD', reason: `bad ${EM_DASH} really\nbad ${'x'.repeat(200)}` });
        const summary = summarizeDeclareBadReplicas(long);
        expect(summary).not.toContain('\n');
        expect(summary.length).toBeLessThan(200);
    });

    it('bounds a long rule id and a long RSE name to one line', () => {
        const longId = `abc\n${'x'.repeat(300)}`;
        const rule = summarizeUpdateRule(UpdateRuleSchema.parse({ ruleId: longId, options: { approve: true } }));
        expect(rule).not.toContain('\n');
        expect(rule.length).toBeLessThan(200);
        const bad = summarizeDeclareBadReplicas(DeclareBadReplicasSchema.parse({ dids: [did('f1')], rse: longId, reason: 'r' }));
        expect(bad).not.toContain('\n');
        expect(bad.length).toBeLessThan(250);
    });
});
