import { z } from 'zod';
import { firstInvalidField, parseQuery, searchParamsToRecord } from '@/lib/infrastructure/api-schemas/parse';

const query = (search: string) => new URLSearchParams(search);

describe('searchParamsToRecord', () => {
    it('keeps single values as strings and repeated keys as arrays in order', () => {
        expect(searchParamsToRecord(query('a=1&b=x&b=y&b=z'))).toEqual({ a: '1', b: ['x', 'y', 'z'] });
    });

    it('returns an empty record for no params', () => {
        expect(searchParamsToRecord(query(''))).toEqual({});
    });
});

describe('parseQuery', () => {
    const Schema = z.object({
        name: z.string().min(1),
        limit: z.number().int().optional(),
        open: z.boolean().optional(),
        tags: z.array(z.string()).optional(),
        sizes: z.array(z.number()).optional(),
    });

    it('coerces numbers and booleans from strings', () => {
        const result = parseQuery(Schema, query('name=a&limit=25&open=false'));
        expect(result.success && result.data).toEqual({ name: 'a', limit: 25, open: false });
    });

    it('wraps a single value for an array field and coerces array elements', () => {
        const result = parseQuery(Schema, query('name=a&tags=x&sizes=1&sizes=2'));
        expect(result.success && result.data).toEqual({ name: 'a', tags: ['x'], sizes: [1, 2] });
    });

    it.each([
        ['a non-numeric number', 'name=a&limit=abc'],
        ['an empty number', 'name=a&limit='],
        ['a non-integer number', 'name=a&limit=2.5'],
        ['a boolean that is not true or false', 'name=a&open=yes'],
        ['a repeated single-valued key', 'name=a&name=b'],
        ['a missing required key', 'limit=1'],
        ['an empty required string', 'name='],
    ])('rejects %s', (_label, search) => {
        expect(parseQuery(Schema, query(search)).success).toBe(false);
    });

    it('strips keys the schema does not declare', () => {
        const result = parseQuery(Schema, query('name=a&unknown=1'));
        expect(result.success && result.data).toEqual({ name: 'a' });
    });

    it('applies object-level refinements', () => {
        const Either = z
            .object({ rse: z.string().optional(), rseName: z.string().optional() })
            .refine(value => Boolean(value.rse || value.rseName), { message: 'need one' });
        expect(parseQuery(Either, query('')).success).toBe(false);
        expect(parseQuery(Either, query('rseName=X')).success).toBe(true);
    });
});

describe('firstInvalidField', () => {
    const Schema = z.object({ scope: z.string().min(1), name: z.string().min(1) });

    it('names the first invalid field in schema order', () => {
        const result = Schema.safeParse({});
        expect(result.success).toBe(false);
        expect(firstInvalidField(result.error!)).toBe('scope');
    });

    it('names a later field when earlier ones are valid', () => {
        const result = Schema.safeParse({ scope: 's' });
        expect(firstInvalidField(result.error!)).toBe('name');
    });

    it('returns undefined for an object-level issue', () => {
        const Refined = z.object({}).refine(() => false, { message: 'never' });
        const result = Refined.safeParse({});
        expect(firstInvalidField(result.error!)).toBeUndefined();
    });
});
