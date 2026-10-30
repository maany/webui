jest.mock('@/lib/infrastructure/hooks/useToast', () => ({ toast: jest.fn() }));

import { z } from 'zod';
import { toast } from '@/lib/infrastructure/hooks/useToast';
import type { ToolSpec } from '@/lib/core/entity/assistant/tool';
import { defineWriteTool, routeName } from '@/lib/infrastructure/assistant/write-tool';
import type { FetchLike, FetchResponseLike } from '@/lib/infrastructure/assistant/write-executor';
import { makeToolContext } from 'test/fixtures/assistant-write-fixtures';

const Schema = z.object({ account: z.string().min(1), key: z.string().min(1) });
type Input = z.infer<typeof Schema>;

const spec: ToolSpec<Input> = {
    name: 'delete_account_attribute',
    domain: 'accounts',
    description: 'Delete an account attribute',
    input: Schema,
    risk: 'write',
    requires: { flags: ['accounts.manage'] },
    executor: 'feature',
    output: 'object',
    route: { path: '/api/feature/delete-account-attribute', method: 'DELETE' },
    describeCall: args => `Delete attribute ${args.key} from account ${args.account}`,
};

function jsonResponse(status: number, body: unknown): FetchResponseLike {
    return {
        ok: status >= 200 && status < 300,
        status,
        type: 'basic',
        redirected: false,
        url: 'http://localhost/api/feature/delete-account-attribute',
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
        text: async () => JSON.stringify(body),
    };
}

describe('routeName', () => {
    it('returns the route directory', () => {
        expect(routeName('/api/feature/create-rule')).toBe('create-rule');
    });
});

describe('defineWriteTool', () => {
    beforeEach(() => jest.mocked(toast).mockClear());

    it('refuses read specs and specs without a route', () => {
        expect(() => defineWriteTool({ ...spec, risk: 'read' })).toThrow('not a write route tool');
        expect(() => defineWriteTool({ ...spec, route: undefined })).toThrow('not a write route tool');
    });

    it('returns invalid_args without sending anything when args fail the route schema', async () => {
        const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>();
        const tool = defineWriteTool(spec, { fetchImpl });
        const result = await tool.execute({ account: '', key: 'country' }, makeToolContext());
        expect(result).toMatchObject({ error: 'invalid_args' });
        expect((result as { message: string }).message).toContain('account');
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('on success returns the view model, invalidates the mutation keys and shows a toast', async () => {
        const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(async () => jsonResponse(200, { status: 'success' }));
        const tool = defineWriteTool(spec, { fetchImpl });
        const ctx = makeToolContext();
        const invalidate = jest.spyOn(ctx.queryClient, 'invalidateQueries').mockResolvedValue(undefined);

        const result = await tool.execute({ account: 'jdoe', key: 'country' }, ctx);

        expect(result).toEqual({ status: 'success' });
        expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'DELETE', body: '{"account":"jdoe","key":"country"}' });
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['account', 'jdoe', 'attributes'] });
        expect(toast).toHaveBeenCalledWith({
            variant: 'success',
            title: 'Rucio bot made a change',
            description: 'Delete attribute country from account jdoe',
        });
    });

    it('on failure returns the ToolError without toast or invalidation', async () => {
        const fetchImpl: FetchLike = async () =>
            jsonResponse(403, { status: 'error', errorType: 'permission_denied', message: 'Administrator role required' });
        const tool = defineWriteTool(spec, { fetchImpl });
        const ctx = makeToolContext();
        const invalidate = jest.spyOn(ctx.queryClient, 'invalidateQueries').mockResolvedValue(undefined);

        const result = await tool.execute({ account: 'jdoe', key: 'country' }, ctx);

        expect(result).toEqual({ error: 'forbidden', message: 'Administrator role required', errorType: 'permission_denied' });
        expect(invalidate).not.toHaveBeenCalled();
        expect(toast).not.toHaveBeenCalled();
    });

    it('still returns the view model when the invalidation rejects', async () => {
        const fetchImpl: FetchLike = async () => jsonResponse(200, { status: 'success' });
        const tool = defineWriteTool(spec, { fetchImpl });
        const ctx = makeToolContext();
        jest.spyOn(ctx.queryClient, 'invalidateQueries').mockRejectedValue(new Error('refetch failed'));

        await expect(tool.execute({ account: 'jdoe', key: 'country' }, ctx)).resolves.toEqual({ status: 'success' });
        expect(toast).toHaveBeenCalledTimes(1);
    });

    it('still returns the view model when the toast or describeCall throws', async () => {
        const fetchImpl: FetchLike = async () => jsonResponse(200, { status: 'success' });
        const tool = defineWriteTool(
            {
                ...spec,
                describeCall: () => {
                    throw new Error('boom');
                },
            },
            { fetchImpl },
        );
        const ctx = makeToolContext();
        jest.spyOn(ctx.queryClient, 'invalidateQueries').mockResolvedValue(undefined);
        await expect(tool.execute({ account: 'jdoe', key: 'country' }, ctx)).resolves.toEqual({ status: 'success' });

        jest.mocked(toast).mockImplementationOnce(() => {
            throw new Error('toast failed');
        });
        const tool2 = defineWriteTool(spec, { fetchImpl });
        await expect(tool2.execute({ account: 'jdoe', key: 'country' }, ctx)).resolves.toEqual({ status: 'success' });
    });

    it('uses an explicit mutation name when given', async () => {
        const fetchImpl: FetchLike = async () => jsonResponse(200, { status: 'success' });
        const tool = defineWriteTool(spec, { fetchImpl, mutation: 'update-rule' });
        const ctx = makeToolContext();
        const invalidate = jest.spyOn(ctx.queryClient, 'invalidateQueries').mockResolvedValue(undefined);
        await tool.execute({ account: 'jdoe', key: 'country' }, ctx);
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rule-meta'] });
    });
});

describe('defineWriteTool account binding', () => {
    it('forwards ctx.accountKey as the expected account header', async () => {
        const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(async () => jsonResponse(200, { status: 'success' }));
        const tool = defineWriteTool(spec, { fetchImpl });
        await tool.execute({ account: 'jdoe', key: 'country' }, makeToolContext({ accountKey: 'jdoe@def' }));
        expect((fetchImpl.mock.calls[0][1].headers as Record<string, string>)['x-rucio-assistant-account']).toBe('jdoe@def');
    });

    it('fails closed without sending when ctx.accountKey is missing', async () => {
        const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(async () => jsonResponse(200, { status: 'success' }));
        const tool = defineWriteTool(spec, { fetchImpl });
        const result = await tool.execute({ account: 'jdoe', key: 'country' }, makeToolContext({ accountKey: '' }));
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(result).toMatchObject({ error: 'denied_by_policy' });
    });
});
