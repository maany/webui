import { z } from 'zod';

describe('zod 4', () => {
    it('provides the zod 4 API that route schemas and assistant tools rely on', () => {
        expect(typeof z.iso.datetime).toBe('function');
        expect(typeof z.toJSONSchema).toBe('function');
    });

    it('reports validation problems on error.issues only', () => {
        const result = z.object({ account: z.string() }).safeParse({});
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.path).toEqual(['account']);
        expect((result.error as unknown as { errors?: unknown }).errors).toBeUndefined();
    });
});
