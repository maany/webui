import { z } from 'zod';

/** GET /api/feature/list-subscription-rule-states query. A missing or empty `account` means the session account. */
export const ListSubscriptionRuleStatesSchema = z.object({
    account: z.string().optional(),
});

export type ListSubscriptionRuleStatesInput = z.infer<typeof ListSubscriptionRuleStatesSchema>;
