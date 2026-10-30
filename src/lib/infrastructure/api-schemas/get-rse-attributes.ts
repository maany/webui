import { z } from 'zod';
import { rseOrRseNameQuerySchema } from './common';

/** GET /api/feature/get-rse-attributes query. Give `rse` or `rseName`; `rse` wins when both are set. */
export const GetRseAttributesSchema = rseOrRseNameQuerySchema;

export type GetRseAttributesInput = z.infer<typeof GetRseAttributesSchema>;
