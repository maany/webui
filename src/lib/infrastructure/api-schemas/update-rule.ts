import { z } from 'zod';

/** PUT /api/feature/update-rule body. */
export const UpdateRuleSchema = z.object({
    ruleId: z.string().min(1),
    options: z
        .object({
            lifetime: z.number().nullable().optional(),
            approve: z.boolean().optional(),
            comment: z.string().optional(),
            priority: z.number().optional(),
        })
        .refine(options => Object.keys(options).length > 0, {
            message: 'At least one update option must be provided',
        }),
});

export type UpdateRuleInput = z.infer<typeof UpdateRuleSchema>;
