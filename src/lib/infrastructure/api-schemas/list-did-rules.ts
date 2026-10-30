import { z } from 'zod';
import { didIdentifierShape } from './common';

/** GET /api/feature/list-did-rules query. */
export const ListDidRulesSchema = z.object(didIdentifierShape);

export type ListDidRulesInput = z.infer<typeof ListDidRulesSchema>;
