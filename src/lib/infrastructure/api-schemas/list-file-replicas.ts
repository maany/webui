import { z } from 'zod';
import { didIdentifierShape } from './common';

/** GET /api/feature/list-file-replicas query. */
export const ListFileReplicasSchema = z.object(didIdentifierShape);

export type ListFileReplicasInput = z.infer<typeof ListFileReplicasSchema>;
