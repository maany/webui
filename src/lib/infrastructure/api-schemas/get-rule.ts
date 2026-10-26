import { z } from 'zod';
import { ruleIdQueryShape } from './common';

/** GET /api/feature/get-rule query. */
export const GetRuleSchema = z.object(ruleIdQueryShape);

export type GetRuleInput = z.infer<typeof GetRuleSchema>;
