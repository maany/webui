import { z } from 'zod';

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
