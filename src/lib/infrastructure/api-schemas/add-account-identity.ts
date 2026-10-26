import { z } from 'zod';
import { isValidEmail } from '@/lib/core/utils/account-validation';
import { accountIdentityKeyShape } from './common';

/** POST /api/feature/add-account-identity body. Admins only. The body can hold a password: never log it. */
export const AddAccountIdentitySchema = z
    .object({
        ...accountIdentityKeyShape,
        email: z.string().refine(isValidEmail, 'Invalid email'),
        password: z.string().min(1).optional(),
        isDefault: z.boolean().optional(),
    })
    .strict();

export type AddAccountIdentityInput = z.infer<typeof AddAccountIdentitySchema>;
