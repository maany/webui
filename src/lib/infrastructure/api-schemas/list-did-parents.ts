import { z } from 'zod';
import { didIdentifierShape } from './common';

/** GET /api/feature/list-did-parents query. */
export const ListDidParentsSchema = z.object(didIdentifierShape);

export type ListDidParentsInput = z.infer<typeof ListDidParentsSchema>;
