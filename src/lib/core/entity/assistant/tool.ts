import type { z } from 'zod';
import type { FeatureKey } from '@/lib/core/entity/feature-config';
import type { Role } from '@/lib/core/entity/auth-models';

/** Name of the SQL tool; its calls are counted as queries, not tools, in the activity label. */
export const RUN_SQL_TOOL_NAME = 'run_sql';

export type ToolRisk = 'read' | 'write' | 'high';
export const TOOL_POLICIES = ['deny', 'ask', 'allow'] as const;
export type ToolPolicy = (typeof TOOL_POLICIES)[number];
export type ToolExecutorKind = 'feature' | 'page' | 'sql' | 'docs' | 'skill' | 'meta';
export type ToolDomain = 'core' | 'dids' | 'rules' | 'rses' | 'accounts' | 'replicas' | 'subscriptions' | 'requests';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface ToolSpec<I = unknown> {
    name: string; // snake_case, unique
    domain: ToolDomain;
    description: string;
    input: z.ZodType<I>;
    risk: ToolRisk;
    requires: { flags: FeatureKey[]; role?: Role };
    executor: ToolExecutorKind;
    output: 'object' | 'rows';
    route?: { path: string; method: HttpMethod }; // feature executor only, path like '/api/feature/list-rules'
    alwaysOn?: boolean; // core tools offered every turn; others load via find_tools
    describeCall(args: I): string; // one line, no em dashes
}

export type ToolErrorCode =
    | 'denied_by_policy'
    | 'rejected_by_user'
    | 'session_expired'
    | 'unauthorized'
    | 'forbidden'
    | 'not_found'
    | 'invalid_args'
    | 'timeout'
    | 'aborted'
    | 'stream_error'
    | 'rucio_error'
    | 'unavailable';

export interface ToolError {
    error: ToolErrorCode;
    message: string;
    errorType?: string; // presenter errorType passthrough
}

export type ToolPolicyPrefs = Record<string, ToolPolicy>; // key: tool name or `group:<ToolDomain>`
