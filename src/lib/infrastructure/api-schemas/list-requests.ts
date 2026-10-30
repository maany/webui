import { z } from 'zod';
import { REQUEST_STATES } from '@/lib/core/entity/request';

/**
 * Query of GET /api/feature/list-requests.
 * Pairing (an RSE pair or a site pair) is checked by the use case, so the schema stays a plain object
 * that tools can turn into JSON Schema.
 */
export const ListRequestsSchema = z.object({
    src_rse: z.string().min(1).optional().describe('Source RSE name, together with dst_rse'),
    dst_rse: z.string().min(1).optional().describe('Destination RSE name, together with src_rse'),
    src_site: z.string().min(1).optional().describe('Source site (RSE attribute "site"), together with dst_site, instead of RSEs'),
    dst_site: z.string().min(1).optional().describe('Destination site, together with src_site'),
    request_states: z
        .array(z.enum(REQUEST_STATES))
        .min(1)
        .optional()
        .describe('Request states to include. Default: QUEUED, SUBMITTING, SUBMITTED, WAITING, PREPARING'),
    activity: z.string().min(1).max(50).optional().describe('Only requests of this activity, for example "User Subscriptions"'),
});

export type ListRequestsInput = z.infer<typeof ListRequestsSchema>;
