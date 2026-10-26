import { z } from 'zod';
import {
    didIdentifierShape,
    nonEmptyString,
    rseOrRseNameQuerySchema,
    ruleFilterShape,
    ruleIdQueryShape,
} from '@/lib/infrastructure/api-schemas/common';

describe('common schema fragments', () => {
    it('nonEmptyString rejects the empty string', () => {
        expect(nonEmptyString.safeParse('a').success).toBe(true);
        expect(nonEmptyString.safeParse('').success).toBe(false);
    });

    it('didIdentifierShape requires scope and name', () => {
        const schema = z.object(didIdentifierShape);
        expect(schema.safeParse({ scope: 's', name: 'n' }).success).toBe(true);
        expect(schema.safeParse({ scope: 's', name: '' }).success).toBe(false);
        expect(schema.safeParse({ name: 'n' }).success).toBe(false);
    });

    it('ruleIdQueryShape requires a non-empty id', () => {
        const schema = z.object(ruleIdQueryShape);
        expect(schema.safeParse({ id: 'r' }).success).toBe(true);
        expect(schema.safeParse({ id: '' }).success).toBe(false);
    });

    it('ruleFilterShape makes every filter optional and validates datetimes', () => {
        const schema = z.object(ruleFilterShape);
        expect(schema.safeParse({}).success).toBe(true);
        expect(schema.safeParse({ updated_after: '2024-01-01T00:00:00Z' }).success).toBe(true);
        expect(schema.safeParse({ updated_after: 'yesterday' }).success).toBe(false);
    });

    it('rseOrRseNameQuerySchema needs a non-empty rse or rseName', () => {
        expect(rseOrRseNameQuerySchema.safeParse({ rse: 'A' }).success).toBe(true);
        expect(rseOrRseNameQuerySchema.safeParse({ rseName: 'B' }).success).toBe(true);
        expect(rseOrRseNameQuerySchema.safeParse({ rse: '', rseName: 'B' }).success).toBe(true);
        expect(rseOrRseNameQuerySchema.safeParse({}).success).toBe(false);
        expect(rseOrRseNameQuerySchema.safeParse({ rse: '', rseName: '' }).success).toBe(false);
    });
});
