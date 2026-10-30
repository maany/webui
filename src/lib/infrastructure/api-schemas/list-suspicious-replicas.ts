import { z } from 'zod';

/** GET /api/feature/list-suspicious-replicas query. All filters are optional. */
export const ListSuspiciousReplicasSchema = z.object({
    rse_expression: z.string().optional(),
    younger_than: z.string().optional(),
    nattempts: z.number().int().optional(),
});

export type ListSuspiciousReplicasInput = z.infer<typeof ListSuspiciousReplicasSchema>;
