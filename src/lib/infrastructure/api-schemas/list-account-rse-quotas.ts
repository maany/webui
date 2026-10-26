import { z } from 'zod';

/** POST /api/feature/list-account-rse-quotas body (read-only). The account comes from the session. */
export const ListAccountRseQuotasSchema = z.object({
    requestedDIDs: z
        .array(
            z.object({
                scope: z.string(),
                name: z.string(),
            }),
        )
        .min(1),
    rseExpression: z.string().optional().default(''),
});

export type ListAccountRseQuotasInput = z.infer<typeof ListAccountRseQuotasSchema>;
