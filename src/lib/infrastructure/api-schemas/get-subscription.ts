import { z } from 'zod';
import { nonEmptyString } from './common';

/** GET /api/feature/get-subscription query. */
export const GetSubscriptionSchema = z.object({
    account: nonEmptyString,
    name: nonEmptyString,
});

export type GetSubscriptionInput = z.infer<typeof GetSubscriptionSchema>;
