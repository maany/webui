import { z } from 'zod';
import { accountAttributeShape } from './common';

/** DELETE /api/feature/delete-account-attribute body. Admins only. */
export const DeleteAccountAttributeSchema = z
    .object({
        account: accountAttributeShape.account,
        key: accountAttributeShape.key,
    })
    .strict();

export type DeleteAccountAttributeInput = z.infer<typeof DeleteAccountAttributeSchema>;
