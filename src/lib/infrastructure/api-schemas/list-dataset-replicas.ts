import { z } from 'zod';
import { didIdentifierShape } from './common';

/** GET /api/feature/list-dataset-replicas query. */
export const ListDatasetReplicasSchema = z.object(didIdentifierShape);

export type ListDatasetReplicasInput = z.infer<typeof ListDatasetReplicasSchema>;
