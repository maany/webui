import { z } from 'zod';
import { nonEmptyString } from './common';

/** GET /api/feature/list-subscription query. The route requires `account` but lists the session account's subscriptions. */
export const ListSubscriptionSchema = z.object({
    account: nonEmptyString,
});

export type ListSubscriptionInput = z.infer<typeof ListSubscriptionSchema>;
