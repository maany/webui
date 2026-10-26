import { z } from 'zod';
import { didIdentifierShape } from './common';

/** POST /api/feature/create-rule body. `account` comes from the session, not the body. */
export const CreateRuleSchema = z.object({
    dids: z.array(z.object(didIdentifierShape)).min(1),
    copies: z.number().min(1),
    rse_expression: z.string().min(1),
    grouping: z.enum(['ALL', 'DATASET', 'NONE']).optional(),
    lifetime_days: z.number().int().positive().optional(),
    notify: z.boolean().optional(),
    comments: z.string().optional(),
    ask_approval: z.boolean().optional(),
    asynchronous: z.boolean().optional(),
    sample: z.boolean().optional(),
    sample_file_count: z.number().int().positive().optional(),
});

export type CreateRuleInput = z.infer<typeof CreateRuleSchema>;
