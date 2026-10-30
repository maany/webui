import { z } from 'zod';
import { isPandaTaskId } from '@/lib/core/utils/panda-task-utils';

const INVALID_TASK_ID = 'Invalid parameter: taskId must be 1 to 12 digits';

/** GET /api/feature/get-panda-task-link query. `taskId` is a PanDA/JEDI task id of 1 to 12 digits. */
export const GetPandaTaskLinkSchema = z.object({
    taskId: z.string(INVALID_TASK_ID).refine(isPandaTaskId, INVALID_TASK_ID),
});

export type GetPandaTaskLinkInput = z.infer<typeof GetPandaTaskLinkSchema>;
