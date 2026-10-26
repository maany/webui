import { z } from 'zod';
import { rseOrRseNameQuerySchema } from './common';

/** GET /api/feature/get-rse-usage query. Give `rse` or `rseName`; `rse` wins when both are set. */
export const GetRseUsageSchema = rseOrRseNameQuerySchema;

export type GetRseUsageInput = z.infer<typeof GetRseUsageSchema>;
