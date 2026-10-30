import { z } from 'zod';
import { didIdentifierShape } from './common';

/** GET /api/feature/list-did-contents query. */
export const ListDidContentsSchema = z.object(didIdentifierShape);

export type ListDidContentsInput = z.infer<typeof ListDidContentsSchema>;
