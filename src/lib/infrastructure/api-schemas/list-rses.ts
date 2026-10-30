import { z } from 'zod';

/** GET /api/feature/list-rses query. A missing expression lists with an empty expression. */
export const ListRsesSchema = z.object({
    rseExpression: z.string().optional(),
});

export type ListRsesInput = z.infer<typeof ListRsesSchema>;
