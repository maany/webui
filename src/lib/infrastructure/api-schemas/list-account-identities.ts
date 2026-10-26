import { z } from 'zod';
import { accountQuerySchema } from './common';

/** GET /api/feature/list-account-identities query. Non-admins may only read their own account. */
export const ListAccountIdentitiesSchema = accountQuerySchema;

export type ListAccountIdentitiesInput = z.infer<typeof ListAccountIdentitiesSchema>;
