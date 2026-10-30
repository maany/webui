import { z } from 'zod';
import { accountIdentityKeyShape } from './common';

/** DELETE /api/feature/delete-account-identity body. Admins only. */
export const DeleteAccountIdentitySchema = z.object(accountIdentityKeyShape).strict();

export type DeleteAccountIdentityInput = z.infer<typeof DeleteAccountIdentitySchema>;
