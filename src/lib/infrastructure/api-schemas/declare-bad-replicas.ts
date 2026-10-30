import { z } from 'zod';
import { didIdentifierShape, nonEmptyString } from './common';

/** POST /api/feature/declare-bad-replicas body. Marks the replicas of `dids` on `rse` as BAD. */
export const DeclareBadReplicasSchema = z.object({
    dids: z.array(z.object(didIdentifierShape)).min(1),
    rse: nonEmptyString,
    reason: nonEmptyString,
    expiresAt: z.string().nullable().optional(),
});

export type DeclareBadReplicasInput = z.infer<typeof DeclareBadReplicasSchema>;
