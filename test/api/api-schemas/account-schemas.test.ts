import { NextRequest } from 'next/server';
import { CreateAccountSchema } from '@/lib/infrastructure/api-schemas/create-account';
import { GetAccountInfoSchema } from '@/lib/infrastructure/api-schemas/get-account-info';
import { GetAccountQuotasSchema } from '@/lib/infrastructure/api-schemas/get-account-quotas';
import { ListAccountRseQuotasSchema } from '@/lib/infrastructure/api-schemas/list-account-rse-quotas';
import { ListAccountRseUsageSchema } from '@/lib/infrastructure/api-schemas/list-account-rse-usage';
import { ListAccountsSchema } from '@/lib/infrastructure/api-schemas/list-accounts';
import { SetAccountLimitSchema } from '@/lib/infrastructure/api-schemas/set-account-limit';
import { UpdateAccountSchema } from '@/lib/infrastructure/api-schemas/update-account';
import { parseQuery } from '@/lib/infrastructure/api-schemas/parse';
import { loadRoute } from '../account/route-test-utils';

jest.mock('@/lib/infrastructure/auth/nextauth-session-utils', () => ({
    __esModule: true,
    getSessionUser: jest.fn(async () => ({ rucioAccount: 'jdoe', rucioIdentity: 'jdoe', isLoggedIn: true })),
}));

const query = (search: string) => new URLSearchParams(search);
const get = (route: string, search: string) => new NextRequest(`http://localhost/api/feature/${route}${search}`);

describe('account schemas', () => {
    it('ListAccountsSchema allows wildcards and known types only', () => {
        expect(parseQuery(ListAccountsSchema, query('account=j*&accountType=SERVICE')).success).toBe(true);
        expect(parseQuery(ListAccountsSchema, query('accountType=ROBOT')).success).toBe(false);
        expect(parseQuery(ListAccountsSchema, query('account=Bad%20Name')).success).toBe(false);
    });

    it('GetAccountInfoSchema treats an empty account as the session account', () => {
        expect(parseQuery(GetAccountInfoSchema, query('account=')).success).toBe(true);
        expect(parseQuery(GetAccountInfoSchema, query('')).success).toBe(true);
        expect(parseQuery(GetAccountInfoSchema, query('account=Bad%20Name')).success).toBe(false);
    });

    it('GetAccountQuotasSchema requires a valid account', () => {
        expect(parseQuery(GetAccountQuotasSchema, query('account=jdoe')).success).toBe(true);
        expect(parseQuery(GetAccountQuotasSchema, query('')).success).toBe(false);
    });

    it('ListAccountRseUsageSchema takes no parameters', () => {
        expect(parseQuery(ListAccountRseUsageSchema, query('')).data).toEqual({});
    });

    it('ListAccountRseQuotasSchema defaults the expression to an empty string', () => {
        const result = ListAccountRseQuotasSchema.safeParse({ requestedDIDs: [{ scope: 's', name: 'n' }] });
        expect(result.success && result.data).toEqual({ requestedDIDs: [{ scope: 's', name: 'n' }], rseExpression: '' });
        expect(ListAccountRseQuotasSchema.safeParse({ requestedDIDs: [] }).success).toBe(false);
    });

    it('CreateAccountSchema rejects unknown keys and reports the custom message', () => {
        expect(CreateAccountSchema.safeParse({ account: 'jdoe', accountType: 'USER', email: null, foo: 1 }).success).toBe(false);
        expect(CreateAccountSchema.safeParse({ account: 'Bad Name', accountType: 'USER', email: null }).error?.issues[0]?.message).toBe(
            'Invalid account name',
        );
    });

    it('UpdateAccountSchema refuses DELETED and empty options', () => {
        expect(UpdateAccountSchema.safeParse({ account: 'jdoe', options: { status: 'SUSPENDED' } }).success).toBe(true);
        expect(UpdateAccountSchema.safeParse({ account: 'jdoe', options: { status: 'DELETED' } }).success).toBe(false);
        expect(UpdateAccountSchema.safeParse({ account: 'jdoe', options: {} }).success).toBe(false);
    });

    it('SetAccountLimitSchema allows -1 for unlimited and nothing lower', () => {
        const base = { account: 'jdoe', locality: 'local', rseExpression: 'XRD1' };
        expect(SetAccountLimitSchema.safeParse({ ...base, bytes: -1 }).success).toBe(true);
        expect(SetAccountLimitSchema.safeParse({ ...base, bytes: -2 }).error?.issues[0]?.message).toBe('Bytes must be -1 (unlimited) or greater');
    });
});

describe('account routes use their schemas', () => {
    it('get-account-info falls back to the session account for an empty value', async () => {
        const { route, execute } = loadRoute<typeof import('@/app/api/feature/get-account-info/route')>('@/app/api/feature/get-account-info/route');
        expect((await route.GET(get('get-account-info', '?account='))).status).toBe(200);
        expect(execute).toHaveBeenCalledWith(expect.anything(), { account: 'jdoe' });
    });

    it('list-accounts passes only the filters that were given', async () => {
        const { route, execute } = loadRoute<typeof import('@/app/api/feature/list-accounts/route')>('@/app/api/feature/list-accounts/route');
        expect((await route.GET(get('list-accounts', '?accountType=GROUP'))).status).toBe(200);
        expect(execute).toHaveBeenCalledWith(expect.anything(), { filter: { accountType: 'GROUP' } }, true);
    });
});
