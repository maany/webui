import { z } from 'zod';
import { ACCOUNT_TYPES } from '@/lib/core/entity/rucio';
import { ACCOUNT_NAME_PATTERN_REGEX } from '@/lib/core/utils/account-validation';

/** GET /api/feature/list-accounts query. `account` may contain `*` wildcards. Admins only. */
export const ListAccountsSchema = z.object({
    account: z.string().regex(ACCOUNT_NAME_PATTERN_REGEX).optional(),
    accountType: z.enum(ACCOUNT_TYPES).optional(),
    identity: z.string().max(1024).optional(),
});

export type ListAccountsInput = z.infer<typeof ListAccountsSchema>;
