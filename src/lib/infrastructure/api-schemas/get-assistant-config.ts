import { z } from 'zod';

/** GET /api/feature/get-assistant-config takes no query parameters. */
export const GetAssistantConfigSchema = z.object({});

export type GetAssistantConfigInput = z.infer<typeof GetAssistantConfigSchema>;
