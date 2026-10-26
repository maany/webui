import { z } from 'zod';
import { accountLimitKeyShape } from './common';

/** DELETE /api/feature/delete-account-limit body. Admins only. */
export const DeleteAccountLimitSchema = z.object(accountLimitKeyShape).strict();

export type DeleteAccountLimitInput = z.infer<typeof DeleteAccountLimitSchema>;
