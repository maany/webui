import { z } from 'zod';

/** GET /api/feature/get-site-header takes no parameters; it reads the session. */
export const GetSiteHeaderSchema = z.object({});

export type GetSiteHeaderInput = z.infer<typeof GetSiteHeaderSchema>;
