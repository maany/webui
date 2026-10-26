import { z } from 'zod';
import { ACCOUNT_NAME_REGEX } from '@/lib/core/utils/account-validation';

/** GET /api/feature/get-account-info query. A missing or empty `account` means the session account. */
export const GetAccountInfoSchema = z.object({
    account: z
        .string()
        .refine(account => account === '' || ACCOUNT_NAME_REGEX.test(account), 'Invalid account name')
        .optional(),
});

export type GetAccountInfoInput = z.infer<typeof GetAccountInfoSchema>;
