import { z } from 'zod';
import { didOnRseQueryShape } from './common';

/** GET /api/feature/get-fts-link query. */
export const GetFtsLinkSchema = z.object(didOnRseQueryShape);

export type GetFtsLinkInput = z.infer<typeof GetFtsLinkSchema>;
