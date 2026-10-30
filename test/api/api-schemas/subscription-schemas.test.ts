import { NextRequest } from 'next/server';
import { GetSubscriptionSchema } from '@/lib/infrastructure/api-schemas/get-subscription';
import { ListSubscriptionSchema } from '@/lib/infrastructure/api-schemas/list-subscription';
import { ListSubscriptionRuleStatesSchema } from '@/lib/infrastructure/api-schemas/list-subscription-rule-states';
import { parseQuery } from '@/lib/infrastructure/api-schemas/parse';
import { loadRoute } from '../account/route-test-utils';

jest.mock('@/lib/infrastructure/auth/nextauth-session-utils', () => ({
    __esModule: true,
    getSessionUser: jest.fn(async () => ({ rucioAccount: 'jdoe', rucioIdentity: 'jdoe', isLoggedIn: true })),
}));

const query = (search: string) => new URLSearchParams(search);
const get = (route: string, search: string) => new NextRequest(`http://localhost/api/feature/${route}${search}`);

describe('subscription schemas', () => {
    it('ListSubscriptionSchema requires account', () => {
        expect(parseQuery(ListSubscriptionSchema, query('account=jdoe')).success).toBe(true);
        expect(parseQuery(ListSubscriptionSchema, query('')).success).toBe(false);
    });

    it('GetSubscriptionSchema requires account and name', () => {
        expect(parseQuery(GetSubscriptionSchema, query('account=jdoe&name=sub')).success).toBe(true);
        expect(parseQuery(GetSubscriptionSchema, query('account=jdoe')).success).toBe(false);
    });

    it('ListSubscriptionRuleStatesSchema makes account optional', () => {
        expect(parseQuery(ListSubscriptionRuleStatesSchema, query('')).data).toEqual({});
    });
});

describe('subscription routes use their schemas', () => {
    it.each([
        ['', 'Missing required parameter: account'],
        ['?account=jdoe', 'Missing required parameter: name'],
    ])('get-subscription keeps its 400 message for %p', async (search, message) => {
        const { route } = loadRoute<typeof import('@/app/api/feature/get-subscription/route')>('@/app/api/feature/get-subscription/route');
        const response = await route.GET(get('get-subscription', search));
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: message });
    });

    it('list-subscription-rule-states falls back to the session account', async () => {
        const { route, execute } = loadRoute<typeof import('@/app/api/feature/list-subscription-rule-states/route')>(
            '@/app/api/feature/list-subscription-rule-states/route',
        );
        expect((await route.GET(get('list-subscription-rule-states', ''))).status).toBe(200);
        expect(execute).toHaveBeenCalledWith(expect.anything(), { account: 'jdoe' }, true);
    });
});
