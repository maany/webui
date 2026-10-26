import { z } from 'zod';
import { nonEmptyString } from './common';

/**
 * GET /api/feature/list-dids query.
 * `filters` entries look like `key=value`, `key>=value` or `key!=value`; repeat the key for several filters.
 */
export const ListDidsSchema = z.object({
    query: nonEmptyString,
    type: nonEmptyString,
    filters: z.array(nonEmptyString).optional(),
});

export type ListDidsInput = z.infer<typeof ListDidsSchema>;
