import { z } from 'zod';
import { isToolError, toolError, toToolError } from '@/lib/infrastructure/assistant/page-tool-errors';

describe('page tool errors', () => {
    it('recognises ToolError shapes only for known codes', () => {
        expect(isToolError(toolError('not_found', 'x'))).toBe(true);
        expect(isToolError({ error: 'made_up', message: 'x' })).toBe(false);
        expect(isToolError({ error: 'not_found' })).toBe(false);
        expect(isToolError('not_found')).toBe(false);
        expect(isToolError(null)).toBe(false);
    });

    it('turns thrown values into ToolErrors', () => {
        expect(toToolError({ error: 'invalid_args', message: 'bad', errorType: 'x' })).toEqual({
            error: 'invalid_args',
            message: 'bad',
            errorType: 'x',
        });
        const zodError = z.object({ copies: z.number() }).safeParse({ copies: 'two' }).error;
        expect(toToolError(zodError)).toMatchObject({ error: 'invalid_args' });
        expect(toToolError(Object.assign(new Error('stop'), { name: 'AbortError' }))).toMatchObject({ error: 'aborted' });
        expect(toToolError(new Error('boom'))).toEqual({ error: 'unavailable', message: 'boom' });
        expect(toToolError(42)).toEqual({ error: 'unavailable', message: 'The page action failed.' });
    });
});
