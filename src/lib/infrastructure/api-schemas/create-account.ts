import { z } from 'zod';
import { ACCOUNT_TYPES } from '@/lib/core/entity/rucio';
import { isValidEmail } from '@/lib/core/utils/account-validation';
import { accountNameField } from './common';

/** POST /api/feature/create-account body. Admins only. */
export const CreateAccountSchema = z
    .object({
        account: accountNameField,
        accountType: z.enum(ACCOUNT_TYPES),
        email: z.string().refine(isValidEmail, 'Invalid email').nullable(),
    })
    .strict();

export type CreateAccountInput = z.infer<typeof CreateAccountSchema>;
