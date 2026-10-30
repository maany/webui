import { NextRequest } from 'next/server';
import { GetAmiTagInfoSchema } from '@/lib/infrastructure/api-schemas/get-ami-tag-info';
import { GetDdmLinkSchema } from '@/lib/infrastructure/api-schemas/get-ddm-link';
import { GetFtsLinkSchema } from '@/lib/infrastructure/api-schemas/get-fts-link';
import { GetPandaTaskLinkSchema } from '@/lib/infrastructure/api-schemas/get-panda-task-link';
import { GetSiteHeaderSchema } from '@/lib/infrastructure/api-schemas/get-site-header';
import { parseQuery } from '@/lib/infrastructure/api-schemas/parse';
import { loadRoute } from '../account/route-test-utils';

const query = (search: string) => new URLSearchParams(search);
const get = (route: string, search: string) => new NextRequest(`http://localhost/api/feature/${route}${search}`);

describe('misc schemas', () => {
    it.each([
        ['GetDdmLinkSchema', GetDdmLinkSchema],
        ['GetFtsLinkSchema', GetFtsLinkSchema],
    ])('%s requires scope, name and rse', (_name, schema) => {
        expect(parseQuery(schema, query('scope=s&name=n&rse=XRD1')).success).toBe(true);
        expect(parseQuery(schema, query('scope=s&name=n')).success).toBe(false);
    });

    it('GetPandaTaskLinkSchema keeps taskId a digit string', () => {
        expect(parseQuery(GetPandaTaskLinkSchema, query('taskId=40703687')).data).toEqual({ taskId: '40703687' });
        expect(parseQuery(GetPandaTaskLinkSchema, query('taskId=abc')).success).toBe(false);
        expect(parseQuery(GetPandaTaskLinkSchema, query('taskId=1234567890123')).success).toBe(false);
    });

    it('GetAmiTagInfoSchema accepts comma-separated or repeated tags', () => {
        expect(parseQuery(GetAmiTagInfoSchema, query('tags=f1723,m2281')).success).toBe(true);
        expect(parseQuery(GetAmiTagInfoSchema, query('tags=f1723&tags=m2281')).success).toBe(true);
        expect(parseQuery(GetAmiTagInfoSchema, query('tags=AOD')).success).toBe(false);
    });

    it('GetAmiTagInfoSchema returns the parsed tags and one message for every failure', () => {
        expect(parseQuery(GetAmiTagInfoSchema, query('tags=f1723, m2281,f1723')).data).toEqual({ tags: ['f1723', 'm2281'] });
        const message = 'Invalid parameter: tags must be 1 to 10 comma-separated AMI tags';
        expect(parseQuery(GetAmiTagInfoSchema, query('')).error?.issues[0]?.message).toBe(message);
        expect(parseQuery(GetAmiTagInfoSchema, query('tags=AOD')).error?.issues[0]?.message).toBe(message);
    });

    it('GetPandaTaskLinkSchema uses one message for a missing or invalid taskId', () => {
        const message = 'Invalid parameter: taskId must be 1 to 12 digits';
        expect(parseQuery(GetPandaTaskLinkSchema, query('')).error?.issues[0]?.message).toBe(message);
        expect(parseQuery(GetPandaTaskLinkSchema, query('taskId=abc')).error?.issues[0]?.message).toBe(message);
    });

    it('GetSiteHeaderSchema takes no parameters', () => {
        expect(parseQuery(GetSiteHeaderSchema, query('')).data).toEqual({});
    });
});

describe('misc routes use their schemas', () => {
    it.each([
        ['?name=n&rse=R', 'Missing required parameter: scope'],
        ['?scope=s&rse=R', 'Missing required parameter: name'],
        ['?scope=s&name=n', 'Missing required parameter: rse'],
    ])('get-ddm-link keeps its 400 message for %p', async (search, message) => {
        const { route } = loadRoute<typeof import('@/app/api/feature/get-ddm-link/route')>('@/app/api/feature/get-ddm-link/route');
        const response = await route.GET(get('get-ddm-link', search));
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: message });
    });

    it('get-fts-link passes scope, name and rse', async () => {
        const { route, execute } = loadRoute<typeof import('@/app/api/feature/get-fts-link/route')>('@/app/api/feature/get-fts-link/route');
        expect((await route.GET(get('get-fts-link', '?scope=s&name=n&rse=R'))).status).toBe(200);
        expect(execute).toHaveBeenCalledWith(expect.anything(), { scope: 's', name: 'n', rse: 'R' });
    });

    it('get-panda-task-link rejects a bad task id before checking the feature binding', async () => {
        const { route } = loadRoute<typeof import('@/app/api/feature/get-panda-task-link/route')>('@/app/api/feature/get-panda-task-link/route');
        const response = await route.GET(get('get-panda-task-link', '?taskId=abc'));
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: 'Invalid parameter: taskId must be 1 to 12 digits' });
    });
});
