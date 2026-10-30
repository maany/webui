import { z } from 'zod';
import { ACCOUNT_TYPES } from '@/lib/core/entity/rucio';
import { isValidEmail } from '@/lib/core/utils/account-validation';
import { accountNameField } from './common';

/** PUT /api/feature/update-account body. Admins only. DELETED is not a valid status: use delete-account. */
export const UpdateAccountSchema = z
    .object({
        account: accountNameField,
        options: z
            .object({
                email: z.string().refine(isValidEmail, 'Invalid email').nullable().optional(),
                status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
                accountType: z.enum(ACCOUNT_TYPES).optional(),
            })
            .strict()
            .refine(options => Object.keys(options).length > 0, { message: 'At least one update option must be provided' }),
    })
    .strict();

export type UpdateAccountInput = z.infer<typeof UpdateAccountSchema>;
