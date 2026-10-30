import { z } from 'zod';
import { accountQuerySchema } from './common';

/** GET /api/feature/get-account-quotas query. Non-admins may only read their own account. */
export const GetAccountQuotasSchema = accountQuerySchema;

export type GetAccountQuotasInput = z.infer<typeof GetAccountQuotasSchema>;
