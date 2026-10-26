import { z } from 'zod';
import { didIdentifierShape } from './common';

/** PUT /api/feature/set-did-status body. */
export const SetDidStatusSchema = z.object({
    ...didIdentifierShape,
    open: z.boolean(),
});

export type SetDidStatusInput = z.infer<typeof SetDidStatusSchema>;
