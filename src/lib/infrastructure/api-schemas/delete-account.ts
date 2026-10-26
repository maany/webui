import { z } from 'zod';
import { accountNameField } from './common';

/** DELETE /api/feature/delete-account body. Admins only. */
export const DeleteAccountSchema = z
    .object({
        account: accountNameField,
    })
    .strict();

export type DeleteAccountInput = z.infer<typeof DeleteAccountSchema>;
