import { z } from 'zod';
import { didIdentifierShape } from './common';

/** POST /api/feature/add-did body. */
export const AddDidSchema = z.object({
    ...didIdentifierShape,
    type: z.enum(['Dataset', 'Container']),
});

export type AddDidInput = z.infer<typeof AddDidSchema>;
