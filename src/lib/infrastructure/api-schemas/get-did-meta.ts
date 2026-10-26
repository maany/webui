import { z } from 'zod';
import { didIdentifierShape } from './common';

/** GET /api/feature/get-did-meta query. */
export const GetDidMetaSchema = z.object(didIdentifierShape);

export type GetDidMetaInput = z.infer<typeof GetDidMetaSchema>;
