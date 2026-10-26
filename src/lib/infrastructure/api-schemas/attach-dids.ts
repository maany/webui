import { z } from 'zod';
import { didIdentifierShape } from './common';

/** POST /api/feature/attach-dids body. `scope` and `name` identify the target dataset or container. */
export const AttachDidsSchema = z.object({
    dids: z.array(z.object(didIdentifierShape)).min(1),
    ...didIdentifierShape,
});

export type AttachDidsInput = z.infer<typeof AttachDidsSchema>;
