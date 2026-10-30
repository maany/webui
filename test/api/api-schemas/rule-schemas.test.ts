import { NextRequest } from 'next/server';
import { CreateRuleSchema } from '@/lib/infrastructure/api-schemas/create-rule';
import { GetRuleSchema } from '@/lib/infrastructure/api-schemas/get-rule';
import { ListDidRulesSchema } from '@/lib/infrastructure/api-schemas/list-did-rules';
import { ListRuleReplicaLockStatesSchema } from '@/lib/infrastructure/api-schemas/list-rule-replica-lock-states';
import { ListRulesSchema } from '@/lib/infrastructure/api-schemas/list-rules';
import { ListRulesPendingApprovalSchema } from '@/lib/infrastructure/api-schemas/list-rules-pending-approval';
import { UpdateRuleSchema } from '@/lib/infrastructure/api-schemas/update-rule';
import { parseQuery } from '@/lib/infrastructure/api-schemas/parse';
import { loadRoute } from '../account/route-test-utils';

jest.mock('@/lib/infrastructure/auth/nextauth-session-utils', () => ({
    __esModule: true,
    getSessionUser: jest.fn(async () => ({ rucioAccount: 'jdoe', rucioIdentity: 'jdoe', isLoggedIn: true })),
}));

const query = (search: string) => new URLSearchParams(search);
const get = (route: string, search: string) => new NextRequest(`http://localhost/api/feature/${route}${search}`);

describe('rule schemas', () => {
    it('ListRulesSchema accepts known states and ISO datetimes', () => {
        const result = parseQuery(ListRulesSchema, query('state=Stuck&updated_after=2024-01-01T00:00:00Z'));
        expect(result.success && result.data).toEqual({ state: 'Stuck', updated_after: '2024-01-01T00:00:00Z' });
    });

    it.each(['state=Unknown', 'state=stuck', 'updated_before=yesterday'])('ListRulesSchema rejects %s', search => {
        expect(parseQuery(ListRulesSchema, query(search)).success).toBe(false);
    });

    it('ListRulesPendingApprovalSchema has no state filter', () => {
        const result = parseQuery(ListRulesPendingApprovalSchema, query('state=Stuck&account=jdoe'));
        expect(result.success && result.data).toEqual({ account: 'jdoe' });
    });

    it.each([
        ['GetRuleSchema', GetRuleSchema],
        ['ListRuleReplicaLockStatesSchema', ListRuleReplicaLockStatesSchema],
    ])('%s requires a non-empty id', (_name, schema) => {
        expect(parseQuery(schema, query('id=abc')).success).toBe(true);
        expect(parseQuery(schema, query('id=')).success).toBe(false);
        expect(parseQuery(schema, query('')).success).toBe(false);
    });

    it('ListDidRulesSchema requires scope and name', () => {
        expect(parseQuery(ListDidRulesSchema, query('scope=s&name=n')).success).toBe(true);
        expect(parseQuery(ListDidRulesSchema, query('scope=s')).success).toBe(false);
    });

    it('CreateRuleSchema needs at least one DID and leaves account to the session', () => {
        const valid = { dids: [{ scope: 's', name: 'n' }], copies: 1, rse_expression: 'X' };
        expect(CreateRuleSchema.safeParse(valid).success).toBe(true);
        expect(CreateRuleSchema.safeParse({ ...valid, dids: [] }).success).toBe(false);
        expect(Object.keys(CreateRuleSchema.shape)).not.toContain('account');
    });

    it('UpdateRuleSchema needs at least one option', () => {
        expect(UpdateRuleSchema.safeParse({ ruleId: 'r', options: { approve: true } }).success).toBe(true);
        const empty = UpdateRuleSchema.safeParse({ ruleId: 'r', options: {} });
        expect(empty.success).toBe(false);
        expect(empty.error?.issues[0]?.message).toBe('At least one update option must be provided');
    });
});

describe('rule routes use their schemas', () => {
    it('get-rule passes the id and keeps its 400 message', async () => {
        const { route, execute } = loadRoute<typeof import('@/app/api/feature/get-rule/route')>('@/app/api/feature/get-rule/route');
        expect((await route.GET(get('get-rule', '?id=abc'))).status).toBe(200);
        expect(execute).toHaveBeenCalledWith(expect.anything(), { id: 'abc' });

        const missing = await route.GET(get('get-rule', ''));
        expect(missing.status).toBe(400);
        await expect(missing.json()).resolves.toEqual({ error: 'Missing required parameter: id' });
    });

    it('list-rules defaults the account to the session and converts dates', async () => {
        const { route, execute } = loadRoute<typeof import('@/app/api/feature/list-rules/route')>('@/app/api/feature/list-rules/route');
        const response = await route.GET(get('list-rules', '?state=OK&updated_after=2024-01-01T00:00:00Z'));
        expect(response.status).toBe(200);
        expect(execute).toHaveBeenCalledWith(
            expect.anything(),
            { filters: { state: 'OK', account: 'jdoe', updated_after: new Date('2024-01-01T00:00:00Z'), updated_before: undefined } },
            true,
        );
    });

    it('list-rules returns 400 with zod issues for an unknown state', async () => {
        const { route, execute } = loadRoute<typeof import('@/app/api/feature/list-rules/route')>('@/app/api/feature/list-rules/route');
        const response = await route.GET(get('list-rules', '?state=Nope'));
        expect(response.status).toBe(400);
        const body = (await response.json()) as { error: string; details: { path: string[] }[] };
        expect(body.error).toBe('Invalid query parameters');
        expect(body.details[0].path).toEqual(['state']);
        expect(execute).not.toHaveBeenCalled();
    });
});
