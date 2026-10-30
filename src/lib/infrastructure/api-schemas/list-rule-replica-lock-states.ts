import { z } from 'zod';
import { ruleIdQueryShape } from './common';

/** GET /api/feature/list-rule-replica-lock-states query. `id` is the rule id. */
export const ListRuleReplicaLockStatesSchema = z.object(ruleIdQueryShape);

export type ListRuleReplicaLockStatesInput = z.infer<typeof ListRuleReplicaLockStatesSchema>;
