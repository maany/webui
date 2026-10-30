import { z } from 'zod';
import { RuleState } from '@/lib/core/entity/rucio';
import { ruleFilterShape } from './common';

/** GET /api/feature/list-rules query. `account` defaults to the session account in the route. */
export const ListRulesSchema = z.object({
    ...ruleFilterShape,
    state: z
        .enum([RuleState.REPLICATING, RuleState.OK, RuleState.STUCK, RuleState.SUSPENDED, RuleState.WAITING_APPROVAL, RuleState.INJECT])
        .optional(),
});

export type ListRulesInput = z.infer<typeof ListRulesSchema>;
