import { z } from 'zod';
import { IDENTITY_TYPES } from '@/lib/core/entity/account';
import { ACCOUNT_ATTRIBUTE_REGEX, ACCOUNT_NAME_REGEX } from '@/lib/core/utils/account-validation';

export const nonEmptyString = z.string().min(1);

/** A DID identifier: `scope` and `name`. Shared by request bodies and query strings. */
export const didIdentifierShape = {
    scope: nonEmptyString,
    name: nonEmptyString,
};

/** Query carrying a rule id as `id`. */
export const ruleIdQueryShape = {
    id: nonEmptyString,
};

/** Optional filters shared by the rule listing queries. */
export const ruleFilterShape = {
    scope: z.string().optional(),
    name: z.string().optional(),
    updated_after: z.iso.datetime().optional(),
    updated_before: z.iso.datetime().optional(),
    account: z.string().optional(),
    activity: z.string().optional(),
};

/** Query naming an RSE as `rse` or `rseName`; `rse` wins when both are set. */
export const rseOrRseNameQuerySchema = z
    .object({
        rse: z.string().optional(),
        rseName: z.string().optional(),
    })
    .refine(query => Boolean(query.rse || query.rseName), { message: 'Missing required parameter: rse or rseName' });

/** An account name. */
export const accountNameField = z.string().regex(ACCOUNT_NAME_REGEX, 'Invalid account name');

/** Query carrying an account as `account`. */
export const accountQuerySchema = z.object({
    account: accountNameField,
});

export const accountAttributeKeyField = z.string().regex(ACCOUNT_ATTRIBUTE_REGEX, 'Invalid attribute key');

/** An account attribute: `account`, `key` and `value`. */
export const accountAttributeShape = {
    account: accountNameField,
    key: accountAttributeKeyField,
    value: z.string().regex(ACCOUNT_ATTRIBUTE_REGEX, 'Invalid attribute value'),
};

/** Identifies one identity of an account: `account`, `identity` and `authType`. */
export const accountIdentityKeyShape = {
    account: accountNameField,
    identity: z.string().trim().min(1, 'Identity is required').max(4096),
    authType: z.enum(IDENTITY_TYPES),
};

/** Identifies one account limit: `account`, `locality` and `rseExpression`. */
export const accountLimitKeyShape = {
    account: accountNameField,
    locality: z.enum(['local', 'global']),
    rseExpression: z.string().min(1, 'RSE expression is required').max(500),
};
