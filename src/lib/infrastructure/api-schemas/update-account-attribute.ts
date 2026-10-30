import { z } from 'zod';
import { accountAttributeShape } from './common';

/** PUT /api/feature/update-account-attribute body. Admins only. */
export const UpdateAccountAttributeSchema = z.object(accountAttributeShape).strict();

export type UpdateAccountAttributeInput = z.infer<typeof UpdateAccountAttributeSchema>;
