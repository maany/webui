import { z } from 'zod';
import { accountAttributeShape } from './common';

/** POST /api/feature/add-account-attribute body. Admins only. */
export const AddAccountAttributeSchema = z.object(accountAttributeShape).strict();

export type AddAccountAttributeInput = z.infer<typeof AddAccountAttributeSchema>;
