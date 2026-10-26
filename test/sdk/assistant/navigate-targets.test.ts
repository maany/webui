import { Role } from '@/lib/core/entity/auth-models';
import { NavigateInputSchema, navigateLabel, resolveNavigateTarget } from '@/lib/infrastructure/assistant/tools/page/navigate-targets';
import { allFlags } from 'test/fixtures/page-tool-context';

const env = { flags: allFlags(), role: Role.USER, account: 'jdoe' };
const resolve = (input: unknown, overrides: Partial<typeof env> = {}) =>
    resolveNavigateTarget(NavigateInputSchema.parse(input), { ...env, ...overrides });

describe('resolveNavigateTarget', () => {
    it.each([
        [{ page: 'dashboard' }, '/dashboard'],
        [{ page: 'dids' }, '/dids'],
        [{ page: 'did', params: { scope: 'user.jdoe', name: 'file 1' } }, '/did/user.jdoe/file%201'],
        [{ page: 'rule', params: { id: 'abc123' } }, '/rule/abc123'],
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
        expect((resolve({ page: 'rule', params: { id: 'abc' } }) as { actionPrefix?: string }).actionPrefix).toBeUndefined();
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

    it('labels calls for the activity timeline', () => {
        expect(navigateLabel({ page: 'rule', params: { id: 'abc' } })).toBe('rule abc');
        expect(navigateLabel({ page: 'did' })).toBe('did');
        expect(navigateLabel({ page: 'rule_create' })).toBe('the create rule wizard');
    });
});
