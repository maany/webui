import { Role } from '@/lib/core/entity/auth-models';
import {
    isListOrWizardAction,
    NavigateInputSchema,
    navigateLabel,
    resolveNavigateTarget,
} from '@/lib/infrastructure/assistant/tools/page/navigate-targets';
import { allFlags } from 'test/fixtures/page-tool-context';

const env = { flags: allFlags(), role: Role.USER, account: 'jdoe' };
const resolve = (input: unknown, overrides: Partial<typeof env> = {}) =>
    resolveNavigateTarget(NavigateInputSchema.parse(input), { ...env, ...overrides });

describe('resolveNavigateTarget', () => {
    it.each([
        [{ page: 'dashboard' }, '/dashboard'],
        [{ page: 'dids' }, '/dids'],
        [{ page: 'did', params: { scope: 'user.jdoe', name: 'file 1' } }, '/did/user.jdoe/file%201'],
        [{ page: 'rule', params: { id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' } }, '/rule/a1b2c3d4e5f60718293a4b5c6d7e8f90'],
        [{ page: 'rule_create' }, '/rule/create'],
        [{ page: 'rses', params: { expression: 'tier=1' } }, '/rses?expression=tier%3D1&autoSearch=true'],
        [{ page: 'rse', params: { rse: 'CERN-PROD' } }, '/rse/CERN-PROD'],
        [{ page: 'subscriptions', params: { account: 'jdoe' } }, '/subscriptions?account=jdoe&autoSearch=true'],
        [{ page: 'subscription', params: { account: 'jdoe', name: 'sub one' } }, '/subscription/jdoe/sub%20one'],
        [{ page: 'account', params: { account: 'jdoe', tab: 'quotas' } }, '/account/jdoe?tab=quotas'],
        [{ page: 'assistant_settings' }, '/assistant/settings'],
    ])('maps %j to %s', (input, url) => {
        expect(resolve(input)).toMatchObject({ url, pathname: url.split('?')[0] });
    });

    it('builds an auto-searching DID URL and defaults the name to *', () => {
        expect(resolve({ page: 'dids', params: { scope: 'user.jdoe', type: 'dataset' } })).toMatchObject({
            url: '/dids?autoSearch=true&scope=user.jdoe&name=*&type=Dataset',
            actionPrefix: 'dids',
        });
    });

    it('builds rule filters with local dates', () => {
        expect(resolve({ page: 'rules', params: { account: 'jdoe', state: 'Stuck', updatedAfter: '2026-01-02' } })).toMatchObject({
            url: '/rules?autoSearch=true&account=jdoe&state=Stuck&updated_after=2026-01-02',
            actionPrefix: 'rules',
        });
    });

    it('sets the action prefix only for pages that offer actions', () => {
        expect(resolve({ page: 'rule_create' })).toMatchObject({ actionPrefix: 'rule_create' });
        expect(resolve({ page: 'rses' })).toMatchObject({ actionPrefix: 'rses' });
        expect(resolve({ page: 'subscriptions' })).toMatchObject({ actionPrefix: 'subscriptions' });
        expect(
            (resolve({ page: 'rule', params: { id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' } }) as { actionPrefix?: string }).actionPrefix,
        ).toBeUndefined();
    });

    it('asks for missing params', () => {
        expect(resolve({ page: 'did', params: { scope: 'user.jdoe' } })).toEqual({
            error: 'invalid_args',
            message: 'Opening did needs params.scope and params.name.',
        });
        expect(resolve({ page: 'rule' })).toMatchObject({ error: 'invalid_args' });
        expect(resolve({ page: 'account' })).toMatchObject({ error: 'invalid_args' });
    });

    it('refuses pages whose feature is off', () => {
        expect(resolve({ page: 'rules' }, { flags: { ...allFlags(), rules: false } })).toEqual({
            error: 'unavailable',
            message: 'The rule list is turned off on this server.',
        });
        expect(resolve({ page: 'rule_create' }, { flags: { ...allFlags(), 'rules.create': false } })).toMatchObject({ error: 'unavailable' });
        expect(resolve({ page: 'rses' }, { flags: undefined })).toMatchObject({ error: 'unavailable' });
        expect(resolve({ page: 'dashboard' }, { flags: undefined })).toMatchObject({ url: '/dashboard' });
    });

    it('keeps admin pages for admins', () => {
        expect(resolve({ page: 'accounts' })).toMatchObject({ error: 'forbidden' });
        expect(resolve({ page: 'accounts' }, { role: Role.ADMIN })).toMatchObject({ url: '/accounts' });
        expect(resolve({ page: 'account', params: { account: 'root' } })).toMatchObject({ error: 'forbidden' });
        expect(resolve({ page: 'account', params: { account: 'jdoe' } })).toMatchObject({ url: '/account/jdoe' });
        expect(resolve({ page: 'account', params: { account: 'root' } }, { role: Role.ADMIN })).toMatchObject({ url: '/account/root' });
    });

    it('validates input', () => {
        expect(NavigateInputSchema.safeParse({ page: 'admin' }).success).toBe(false);
        expect(NavigateInputSchema.safeParse({ page: 'rules', params: { updatedAfter: '2026-02-30' } }).success).toBe(false);
        expect(NavigateInputSchema.safeParse({ page: 'rules', params: { updatedAfter: '02/01/2026' } }).success).toBe(false);
        expect(NavigateInputSchema.safeParse({ page: 'account', params: { account: 'jdoe', tab: 'billing' } }).success).toBe(false);
    });

    it('rejects rule ids that are not 32 hex characters', () => {
        expect(NavigateInputSchema.safeParse({ page: 'rule', params: { id: 'create' } }).success).toBe(false);
        expect(NavigateInputSchema.safeParse({ page: 'rule', params: { id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' } }).success).toBe(true);
    });

    it('caps the length of free text params', () => {
        expect(NavigateInputSchema.safeParse({ page: 'rses', params: { expression: 'a'.repeat(1001) } }).success).toBe(false);
        expect(NavigateInputSchema.safeParse({ page: 'rses', params: { expression: 'a'.repeat(1000) } }).success).toBe(true);
        for (const key of ['scope', 'name', 'rse', 'account', 'activity']) {
            expect(NavigateInputSchema.safeParse({ page: 'rules', params: { [key]: 'a'.repeat(256) } }).success).toBe(false);
            expect(NavigateInputSchema.safeParse({ page: 'rules', params: { [key]: 'a'.repeat(255) } }).success).toBe(true);
        }
    });

    it('knows which action names belong to list and wizard pages', () => {
        expect(isListOrWizardAction('rules.filter')).toBe(true);
        expect(isListOrWizardAction('rule_create.prefill')).toBe(true);
        expect(isListOrWizardAction('dids.search')).toBe(true);
        expect(isListOrWizardAction('other.thing')).toBe(false);
    });

    it('labels calls for the activity timeline', () => {
        expect(navigateLabel({ page: 'rule', params: { id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' } })).toBe('rule a1b2c3d4e5f60718293a4b5c6d7e8f90');
        expect(navigateLabel({ page: 'did' })).toBe('did');
        expect(navigateLabel({ page: 'rule_create' })).toBe('the create rule wizard');
    });
});
