import { NextRequest } from 'next/server';
import { GetRseSchema } from '@/lib/infrastructure/api-schemas/get-rse';
import { GetRseAttributesSchema } from '@/lib/infrastructure/api-schemas/get-rse-attributes';
import { GetRseProtocolsSchema } from '@/lib/infrastructure/api-schemas/get-rse-protocols';
import { GetRseUsageSchema } from '@/lib/infrastructure/api-schemas/get-rse-usage';
import { ListAllRsesSchema } from '@/lib/infrastructure/api-schemas/list-all-rses';
import { ListRsesSchema } from '@/lib/infrastructure/api-schemas/list-rses';
import { parseQuery } from '@/lib/infrastructure/api-schemas/parse';
import { loadRoute } from '../account/route-test-utils';

const query = (search: string) => new URLSearchParams(search);
const get = (route: string, search: string) => new NextRequest(`http://localhost/api/feature/${route}${search}`);

describe('RSE schemas', () => {
    it('GetRseSchema requires rseName', () => {
        expect(parseQuery(GetRseSchema, query('rseName=XRD1')).success).toBe(true);
        expect(parseQuery(GetRseSchema, query('rse=XRD1')).success).toBe(false);
    });

    it.each([
        ['GetRseAttributesSchema', GetRseAttributesSchema],
        ['GetRseProtocolsSchema', GetRseProtocolsSchema],
        ['GetRseUsageSchema', GetRseUsageSchema],
    ])('%s accepts rse or rseName but not neither', (_name, schema) => {
        expect(parseQuery(schema, query('rse=XRD1')).success).toBe(true);
        expect(parseQuery(schema, query('rseName=XRD1')).success).toBe(true);
        expect(parseQuery(schema, query('rse=&rseName=XRD1')).success).toBe(true);
        const neither = parseQuery(schema, query(''));
        expect(neither.success).toBe(false);
        expect(neither.error?.issues[0]?.message).toBe('Missing required parameter: rse or rseName');
    });

    it('ListRsesSchema treats the expression as optional', () => {
        expect(parseQuery(ListRsesSchema, query('')).data).toEqual({});
        expect(parseQuery(ListRsesSchema, query('rseExpression=tier=1')).data).toEqual({ rseExpression: 'tier=1' });
    });

    it('ListAllRsesSchema takes no parameters', () => {
        expect(parseQuery(ListAllRsesSchema, query('anything=1')).data).toEqual({});
    });
});

describe('RSE routes use their schemas', () => {
    it('get-rse-attributes prefers rse over rseName', async () => {
        const { route, execute } = loadRoute<typeof import('@/app/api/feature/get-rse-attributes/route')>(
            '@/app/api/feature/get-rse-attributes/route',
        );
        expect((await route.GET(get('get-rse-attributes', '?rse=A&rseName=B'))).status).toBe(200);
        expect(execute).toHaveBeenCalledWith(expect.anything(), { rseName: 'A' });
    });

    it('get-rse-usage keeps its 400 message', async () => {
        const { route } = loadRoute<typeof import('@/app/api/feature/get-rse-usage/route')>('@/app/api/feature/get-rse-usage/route');
        const response = await route.GET(get('get-rse-usage', ''));
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: 'Missing required parameter: rse or rseName' });
    });

    it('list-rses passes an empty expression when none is given', async () => {
        const { route, execute } = loadRoute<typeof import('@/app/api/feature/list-rses/route')>('@/app/api/feature/list-rses/route');
        expect((await route.GET(get('list-rses', ''))).status).toBe(200);
        expect(execute).toHaveBeenCalledWith(expect.anything(), { rseExpression: '' }, true);
    });
});
