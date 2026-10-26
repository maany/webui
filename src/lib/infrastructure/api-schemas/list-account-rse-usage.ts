import { z } from 'zod';

/** GET /api/feature/list-account-rse-usage takes no parameters; the account comes from the session. */
export const ListAccountRseUsageSchema = z.object({});

export type ListAccountRseUsageInput = z.infer<typeof ListAccountRseUsageSchema>;
