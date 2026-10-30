import { z } from 'zod';
import { didIdentifierShape } from './common';

/** GET /api/feature/get-did-keyvaluepairs query. */
export const GetDidKeyvaluepairsSchema = z.object(didIdentifierShape);

export type GetDidKeyvaluepairsInput = z.infer<typeof GetDidKeyvaluepairsSchema>;
