import { z } from 'zod';
import { nonEmptyString } from './common';

/** GET /api/feature/get-rse query. */
export const GetRseSchema = z.object({
    rseName: nonEmptyString,
});

export type GetRseInput = z.infer<typeof GetRseSchema>;
