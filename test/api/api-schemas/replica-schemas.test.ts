import { NextRequest } from 'next/server';
import { DeclareBadReplicasSchema } from '@/lib/infrastructure/api-schemas/declare-bad-replicas';
import { ListDatasetReplicasSchema } from '@/lib/infrastructure/api-schemas/list-dataset-replicas';
import { ListFileReplicasSchema } from '@/lib/infrastructure/api-schemas/list-file-replicas';
import { ListSuspiciousReplicasSchema } from '@/lib/infrastructure/api-schemas/list-suspicious-replicas';
import { parseQuery } from '@/lib/infrastructure/api-schemas/parse';
import { loadRoute } from '../account/route-test-utils';

const query = (search: string) => new URLSearchParams(search);
const get = (route: string, search: string) => new NextRequest(`http://localhost/api/feature/${route}${search}`);

describe('replica schemas', () => {
    it.each([
        ['ListDatasetReplicasSchema', ListDatasetReplicasSchema],
        ['ListFileReplicasSchema', ListFileReplicasSchema],
    ])('%s requires scope and name', (_name, schema) => {
        expect(parseQuery(schema, query('scope=s&name=n')).success).toBe(true);
        expect(parseQuery(schema, query('scope=s')).success).toBe(false);
    });

    it('ListSuspiciousReplicasSchema coerces nattempts to an integer', () => {
        expect(parseQuery(ListSuspiciousReplicasSchema, query('nattempts=0')).data).toEqual({ nattempts: 0 });
        expect(parseQuery(ListSuspiciousReplicasSchema, query('nattempts=abc')).success).toBe(false);
        expect(parseQuery(ListSuspiciousReplicasSchema, query('')).data).toEqual({});
    });

    it('DeclareBadReplicasSchema needs DIDs, an RSE and a reason', () => {
        const valid = { dids: [{ scope: 's', name: 'f' }], rse: 'XRD1', reason: 'corrupted', expiresAt: null };
        expect(DeclareBadReplicasSchema.safeParse(valid).success).toBe(true);
        expect(DeclareBadReplicasSchema.safeParse({ ...valid, reason: '' }).success).toBe(false);
        expect(DeclareBadReplicasSchema.safeParse({ ...valid, dids: [] }).success).toBe(false);
    });
});

describe('replica routes use their schemas', () => {
    it('list-suspicious-replicas passes nattempts as a number', async () => {
        const { route, execute } = loadRoute<typeof import('@/app/api/feature/list-suspicious-replicas/route')>(
            '@/app/api/feature/list-suspicious-replicas/route',
        );
        expect((await route.GET(get('list-suspicious-replicas', '?rse_expression=XRD1&nattempts=3'))).status).toBe(200);
        expect(execute).toHaveBeenCalledWith(expect.anything(), { rseExpression: 'XRD1', youngerThan: undefined, nattempts: 3 }, true);
    });

    it('list-suspicious-replicas rejects a non-integer nattempts', async () => {
        const { route, execute } = loadRoute<typeof import('@/app/api/feature/list-suspicious-replicas/route')>(
            '@/app/api/feature/list-suspicious-replicas/route',
        );
        const response = await route.GET(get('list-suspicious-replicas', '?nattempts=abc'));
        expect(response.status).toBe(400);
        expect(((await response.json()) as { error: string }).error).toBe('Invalid query parameters');
        expect(execute).not.toHaveBeenCalled();
    });
});
