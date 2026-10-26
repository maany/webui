import { z } from 'zod';

/** GET /api/feature/list-all-rses takes no parameters. */
export const ListAllRsesSchema = z.object({});

export type ListAllRsesInput = z.infer<typeof ListAllRsesSchema>;
