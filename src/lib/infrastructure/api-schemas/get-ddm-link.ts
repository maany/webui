import { z } from 'zod';
import { didOnRseQueryShape } from './common';

/** GET /api/feature/get-ddm-link query. */
export const GetDdmLinkSchema = z.object(didOnRseQueryShape);

export type GetDdmLinkInput = z.infer<typeof GetDdmLinkSchema>;
