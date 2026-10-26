import { z } from 'zod';
import {
    accountAttributeKeyField,
    accountAttributeShape,
    accountIdentityKeyShape,
    accountLimitKeyShape,
    accountNameField,
    accountQuerySchema,
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

    it('accountNameField accepts valid names and reports the custom message', () => {
        expect(accountNameField.safeParse('jdoe').success).toBe(true);
        expect(accountNameField.safeParse('Bad Name').error?.issues[0]?.message).toBe('Invalid account name');
    });

    it('accountQuerySchema requires a valid account', () => {
        expect(accountQuerySchema.safeParse({ account: 'jdoe' }).success).toBe(true);
        expect(accountQuerySchema.safeParse({}).success).toBe(false);
        expect(accountQuerySchema.safeParse({ account: 'Bad Name' }).success).toBe(false);
    });

    it('accountAttributeKeyField and accountAttributeShape validate key and value', () => {
        expect(accountAttributeKeyField.safeParse('admin').success).toBe(true);
        expect(accountAttributeKeyField.safeParse('bad key').error?.issues[0]?.message).toBe('Invalid attribute key');
        const schema = z.object(accountAttributeShape);
        expect(schema.safeParse({ account: 'jdoe', key: 'k', value: 'v' }).success).toBe(true);
        expect(schema.safeParse({ account: 'jdoe', key: 'k', value: 'bad value' }).error?.issues[0]?.message).toBe('Invalid attribute value');
    });

    it('accountIdentityKeyShape requires account, a non-blank identity and a known auth type', () => {
        const schema = z.object(accountIdentityKeyShape);
        expect(schema.safeParse({ account: 'jdoe', identity: 'me', authType: 'USERPASS' }).success).toBe(true);
        expect(schema.safeParse({ account: 'jdoe', identity: '  ', authType: 'USERPASS' }).error?.issues[0]?.message).toBe('Identity is required');
        expect(schema.safeParse({ account: 'jdoe', identity: 'me', authType: 'NOPE' }).success).toBe(false);
    });

    it('accountLimitKeyShape requires account, locality and an RSE expression', () => {
        const schema = z.object(accountLimitKeyShape);
        expect(schema.safeParse({ account: 'jdoe', locality: 'global', rseExpression: 'X' }).success).toBe(true);
        expect(schema.safeParse({ account: 'jdoe', locality: 'other', rseExpression: 'X' }).success).toBe(false);
        expect(schema.safeParse({ account: 'jdoe', locality: 'local', rseExpression: '' }).error?.issues[0]?.message).toBe(
            'RSE expression is required',
        );
    });
});
