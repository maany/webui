import { z } from 'zod';
import { rseOrRseNameQuerySchema } from './common';

/** GET /api/feature/get-rse-protocols query. Give `rse` or `rseName`; `rse` wins when both are set. */
export const GetRseProtocolsSchema = rseOrRseNameQuerySchema;

export type GetRseProtocolsInput = z.infer<typeof GetRseProtocolsSchema>;
