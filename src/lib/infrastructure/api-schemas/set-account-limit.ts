import { z } from 'zod';
import { accountLimitKeyShape } from './common';

/** PUT /api/feature/set-account-limit body. Admins only. `bytes` -1 means unlimited. */
export const SetAccountLimitSchema = z
    .object({
        ...accountLimitKeyShape,
        bytes: z.number().int().min(-1, 'Bytes must be -1 (unlimited) or greater'),
    })
    .strict();

export type SetAccountLimitInput = z.infer<typeof SetAccountLimitSchema>;
