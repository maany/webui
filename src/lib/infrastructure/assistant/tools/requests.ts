import { createFeatureTool } from '@/lib/infrastructure/assistant/feature-executor';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';
import type { ToolSpec } from '@/lib/core/entity/assistant/tool';
import { ACTIVE_REQUEST_STATES } from '@/lib/core/entity/request';
import { defineReadTool, text, type ToolArgs } from './read-tool-helpers';

const ACTIVE_STATES_TEXT = ACTIVE_REQUEST_STATES.join(', ');

const LIST_REQUESTS_DESCRIPTION = [
    'List transfer requests between a source and a destination, one row per file transfer.',
    'Give src_rse and dst_rse, or src_site and dst_site (sites resolve through the RSE attribute "site").',
    `request_states defaults to the active states ${ACTIVE_STATES_TEXT}; finished requests are archived to the request history soon after, so DONE and FAILED rows here are only the most recent ones.`,
    'activity keeps only requests of that activity; it is filtered in the WebUI, so it does not make the Rucio query faster.',
    'Rows: id, requestType, scope, name, didType, state, activity, bytes, sourceRse, destRse, account, ruleId, retryCount, priority, transfertool, externalHost, externalId, errMsg and ISO times createdAt, updatedAt, requestedAt, submittedAt, startedAt, transferredAt.',
    'For "how much data is in transfer from A to B", call this tool, then run_sql on the handle it returns (for example requests_1):',
    'SELECT state, COUNT(*) AS files, SUM(bytes) AS total_bytes FROM requests_1 GROUP BY state.',
    'Busy links return many rows; narrow with request_states. If the result says truncated, SUM(bytes) is a lower bound.',
    "Permission: Rucio's default policy only lets admin accounts (root or the admin attribute) list requests.",
    'Other accounts get a forbidden error with errorType permission_denied; tell the user that instead of retrying.',
].join(' ');

/** One line for the activity timeline and approval cards. */
export function describeListRequestsCall(args: ToolArgs): string {
    const srcSite = text(args, 'src_site');
    const dstSite = text(args, 'dst_site');
    const from = text(args, 'src_rse') || (srcSite ? `site ${srcSite}` : 'an unknown source');
    const to = text(args, 'dst_rse') || (dstSite ? `site ${dstSite}` : 'an unknown destination');
    const states = text(args, 'request_states') || ACTIVE_STATES_TEXT;
    const activity = text(args, 'activity');
    return `List transfer requests from ${from} to ${to} (${states}${activity ? `, activity ${activity}` : ''})`;
}

export const listRequestsSpec: ToolSpec<ToolArgs> = defineReadTool({
    route: 'list-requests',
    domain: 'requests',
    output: 'rows',
    flags: ['requests'],
    description: LIST_REQUESTS_DESCRIPTION,
    describeCall: describeListRequestsCall,
});

export const requestToolSpecs: ToolSpec<ToolArgs>[] = [listRequestsSpec];

export const requestTools: RegisteredTool<ToolArgs>[] = requestToolSpecs.map(spec => createFeatureTool(spec));
