import { z } from 'zod';
import { ruleFilterShape } from './common';

/** GET /api/feature/list-rules-pending-approval query. */
export const ListRulesPendingApprovalSchema = z.object(ruleFilterShape);

export type ListRulesPendingApprovalInput = z.infer<typeof ListRulesPendingApprovalSchema>;
