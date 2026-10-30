import { NextRequest } from 'next/server';
import { AddDidSchema } from '@/lib/infrastructure/api-schemas/add-did';
import { AttachDidsSchema } from '@/lib/infrastructure/api-schemas/attach-dids';
import { GetDidKeyvaluepairsSchema } from '@/lib/infrastructure/api-schemas/get-did-keyvaluepairs';
import { GetDidMetaSchema } from '@/lib/infrastructure/api-schemas/get-did-meta';
import { ListDidContentsSchema } from '@/lib/infrastructure/api-schemas/list-did-contents';
import { ListDidParentsSchema } from '@/lib/infrastructure/api-schemas/list-did-parents';
import { ListDidsSchema } from '@/lib/infrastructure/api-schemas/list-dids';
import { SetDidStatusSchema } from '@/lib/infrastructure/api-schemas/set-did-status';
import { parseQuery } from '@/lib/infrastructure/api-schemas/parse';
import { loadRoute } from '../account/route-test-utils';

const query = (search: string) => new URLSearchParams(search);
const get = (route: string, search: string) => new NextRequest(`http://localhost/api/feature/${route}${search}`);

describe('DID schemas', () => {
    it.each([
        ['GetDidMetaSchema', GetDidMetaSchema],
        ['GetDidKeyvaluepairsSchema', GetDidKeyvaluepairsSchema],
        ['ListDidContentsSchema', ListDidContentsSchema],
        ['ListDidParentsSchema', ListDidParentsSchema],
    ])('%s requires a non-empty scope and name', (_name, schema) => {
        expect(parseQuery(schema, query('scope=s&name=n')).success).toBe(true);
        expect(parseQuery(schema, query('scope=s&name=')).success).toBe(false);
        expect(parseQuery(schema, query('name=n')).success).toBe(false);
    });

    it('ListDidsSchema turns one or many filters into an array', () => {
        expect(parseQuery(ListDidsSchema, query('query=s:n*&type=dataset')).data).toEqual({ query: 's:n*', type: 'dataset' });
        expect(parseQuery(ListDidsSchema, query('query=s:n*&type=dataset&filters=a=1')).data?.filters).toEqual(['a=1']);
        expect(parseQuery(ListDidsSchema, query('query=s:n*&type=dataset&filters=a=1&filters=b>=2')).data?.filters).toEqual(['a=1', 'b>=2']);
    });

    it('ListDidsSchema rejects an empty filter entry', () => {
        expect(parseQuery(ListDidsSchema, query('query=s:n*&type=dataset&filters=')).success).toBe(false);
        expect(parseQuery(ListDidsSchema, query('query=s:n*&type=dataset&filters=a=1&filters=')).success).toBe(false);
        expect(parseQuery(ListDidsSchema, query('query=s:n*&type=dataset&filters=a=1')).success).toBe(true);
    });

    it('AddDidSchema only creates datasets and containers', () => {
        expect(AddDidSchema.safeParse({ scope: 's', name: 'n', type: 'Dataset' }).success).toBe(true);
        expect(AddDidSchema.safeParse({ scope: 's', name: 'n', type: 'File' }).success).toBe(false);
    });

    it('AttachDidsSchema needs at least one DID to attach', () => {
        expect(AttachDidsSchema.safeParse({ dids: [{ scope: 's', name: 'f' }], scope: 's', name: 'ds' }).success).toBe(true);
        expect(AttachDidsSchema.safeParse({ dids: [], scope: 's', name: 'ds' }).success).toBe(false);
    });

    it('SetDidStatusSchema needs a boolean open flag', () => {
        expect(SetDidStatusSchema.safeParse({ scope: 's', name: 'n', open: false }).success).toBe(true);
        expect(SetDidStatusSchema.safeParse({ scope: 's', name: 'n', open: 'false' }).success).toBe(false);
    });
});

describe('DID routes use their schemas', () => {
    it('list-dids parses filters into DIDFilter objects', async () => {
        const { route, execute } = loadRoute<typeof import('@/app/api/feature/list-dids/route')>('@/app/api/feature/list-dids/route');
        const response = await route.GET(get('list-dids', '?query=s:n*&type=dataset&filters=length%3E%3D10&filters=project=data'));
        expect(response.status).toBe(200);
        expect(execute).toHaveBeenCalledWith(
            expect.anything(),
            {
                query: 's:n*',
                type: 'dataset',
                filters: [
                    { key: 'length', operator: '>=', value: '10' },
                    { key: 'project', operator: '=', value: 'data' },
                ],
            },
            true,
        );
    });

    it.each([
        ['', 'Missing required parameter: query'],
        ['?query=s:n*', 'Missing required parameter: type'],
    ])('list-dids keeps its 400 message for %p', async (search, message) => {
        const { route } = loadRoute<typeof import('@/app/api/feature/list-dids/route')>('@/app/api/feature/list-dids/route');
        const response = await route.GET(get('list-dids', search));
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: message });
    });

    it('list-dids returns 400 for an empty filter', async () => {
        const { route, execute } = loadRoute<typeof import('@/app/api/feature/list-dids/route')>('@/app/api/feature/list-dids/route');
        const response = await route.GET(get('list-dids', '?query=s:n*&type=dataset&filters='));
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: 'Invalid parameter: filters' });
        expect(execute).not.toHaveBeenCalled();
    });

    it.each([
        ['', 'Missing required parameter: scope'],
        ['?scope=s', 'Missing required parameter: name'],
    ])('list-did-contents keeps its 400 message for %p', async (search, message) => {
        const { route, execute } = loadRoute<typeof import('@/app/api/feature/list-did-contents/route')>('@/app/api/feature/list-did-contents/route');
        const response = await route.GET(get('list-did-contents', search));
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: message });
        expect(execute).not.toHaveBeenCalled();
    });
});
