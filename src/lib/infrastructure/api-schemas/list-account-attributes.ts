import { z } from 'zod';
import { accountQuerySchema } from './common';

/** GET /api/feature/list-account-attributes query. Non-admins may only read their own account. */
export const ListAccountAttributesSchema = accountQuerySchema;

export type ListAccountAttributesInput = z.infer<typeof ListAccountAttributesSchema>;
