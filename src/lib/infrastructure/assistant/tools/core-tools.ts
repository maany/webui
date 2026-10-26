import { z } from 'zod';
import type { ToolSpec } from '@/lib/core/entity/assistant/tool';
import { MAX_SQL_LENGTH } from '@/lib/core/services/assistant-sql-guard';
import { searchToolSpecs } from '@/lib/core/services/assistant-tool-search';
import { HANDLE_NAME_PATTERN } from '@/lib/infrastructure/assistant/duckdb/duckdb-data-handle-store';
import { refreshHandle } from '@/lib/infrastructure/assistant/refresh-handle';
import { capSqlResultForModel, SQL_MAX_ROWS_FOR_MODEL, sqlErrorToToolError } from '@/lib/infrastructure/assistant/sql-support';
import { allTools } from '@/lib/infrastructure/assistant/tool-registry';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';

const SEARCHABLE_DOMAINS = ['dids', 'rules', 'rses', 'accounts', 'replicas', 'subscriptions', 'requests'] as const;

export const FindToolsInput = z.object({
    query: z.string().min(1).max(200).describe('A few keywords, for example "stuck rules" or "rse usage"'),
    domain: z.enum(SEARCHABLE_DOMAINS).optional().describe('Only search one domain'),
});
export type FindToolsArgs = z.infer<typeof FindToolsInput>;

export const findToolsSpec: ToolSpec<FindToolsArgs> = {
    name: 'find_tools',
    domain: 'core',
    description:
        'Search the Rucio tools by keywords and load the best matches so you can call them in your next step. Tools for DIDs, rules, RSEs, accounts, replicas and subscriptions are not available until you load them here.',
    input: FindToolsInput,
    risk: 'read',
    requires: { flags: [] },
    executor: 'meta',
    output: 'object',
    alwaysOn: true,
    describeCall: args => `Find tools for "${args.query}"${args.domain ? ` in ${args.domain}` : ''}`,
};

export const findToolsTool: RegisteredTool<FindToolsArgs> = {
    spec: findToolsSpec,
    execute: async (args, ctx) => {
        // Fail closed: without a live visibility check nothing can be offered.
        if (!ctx.isToolVisible) return { tools: [], note: 'No tools can be loaded right now.' };
        const isVisible = ctx.isToolVisible;
        const candidates = allTools()
            .map(tool => tool.spec)
            .filter(spec => spec.alwaysOn !== true && spec.domain !== 'core' && isVisible(spec.name));
        const hits = searchToolSpecs(candidates, args.query, { domain: args.domain });
        if (hits.length === 0) {
            return {
                tools: [],
                note: 'No matching tools. Try other keywords or one of the domains: dids, rules, rses, accounts, replicas, subscriptions, requests.',
            };
        }
        ctx.activateTools?.(hits.map(hit => hit.name));
        return {
            tools: hits.map(hit => ({ name: hit.name, domain: hit.domain, description: hit.description })),
            note: 'These tools are loaded. Call them directly in your next step.',
        };
    },
};

export const RunSqlInput = z.object({
    sql: z
        .string()
        .min(1)
        .max(MAX_SQL_LENGTH)
        .describe('One SELECT or WITH statement over data handles, for example SELECT state, count(*) AS n FROM rules_1 GROUP BY state'),
    save_as: z
        .string()
        .regex(HANDLE_NAME_PATTERN)
        .optional()
        .describe('Optional handle name that keeps the full result as a new table, for example stuck_rules'),
});
export type RunSqlArgs = z.infer<typeof RunSqlInput>;

export const runSqlSpec: ToolSpec<RunSqlArgs> = {
    name: 'run_sql',
    domain: 'core',
    description:
        'Run one read-only DuckDB query (SELECT or WITH) over the data handles that list tools create. Handles are tables named like rules_1 and can be joined. Returns at most 200 rows plus the total row count. Dates are ISO text: use CAST(column AS TIMESTAMP). Pass save_as to keep the full result as a new handle.',
    input: RunSqlInput,
    risk: 'read',
    requires: { flags: [] },
    executor: 'sql',
    output: 'object',
    alwaysOn: true,
    describeCall: args => {
        const flat = args.sql.replace(/\s+/g, ' ').trim();
        const sql = flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
        return args.save_as ? `Run SQL and save as ${args.save_as}: ${sql}` : `Run SQL: ${sql}`;
    },
};

export const runSqlTool: RegisteredTool<RunSqlArgs> = {
    spec: runSqlSpec,
    execute: async (args, ctx) => {
        const started = Date.now();
        try {
            const result = await ctx.handles.query(args.sql, { maxRows: SQL_MAX_ROWS_FOR_MODEL, saveAs: args.save_as, signal: ctx.signal });
            // Events carry the SQL text and counts only, never rows.
            ctx.emit({
                type: 'sql-executed',
                turnId: ctx.turnId,
                toolCallId: ctx.toolCallId,
                sql: args.sql,
                totalRows: result.totalRows,
                durationMs: Date.now() - started,
                at: Date.now(),
            });
            return capSqlResultForModel(result);
        } catch (error) {
            return sqlErrorToToolError(
                error,
                ctx.handleRecords?.() ?? [],
                ctx.handles.listHandles().map(handle => handle.name),
            );
        }
    },
};

export const RefreshHandleInput = z.object({
    handle: z.string().regex(HANDLE_NAME_PATTERN).describe('The handle to fetch again, for example rules_1'),
});
export type RefreshHandleArgs = z.infer<typeof RefreshHandleInput>;

export const refreshHandleSpec: ToolSpec<RefreshHandleArgs> = {
    name: 'refresh_handle',
    domain: 'core',
    description:
        'Fetch the data behind a handle again (for example after it expired) by re-running the tool call or saved query that created it. The handle keeps its name, so earlier SQL still works.',
    input: RefreshHandleInput,
    risk: 'read',
    requires: { flags: [] },
    executor: 'meta',
    output: 'object',
    alwaysOn: true,
    describeCall: args => `Refresh data handle ${args.handle}`,
};

export const refreshHandleTool: RegisteredTool<RefreshHandleArgs> = {
    spec: refreshHandleSpec,
    execute: (args, ctx) =>
        refreshHandle(args.handle, {
            records: ctx.handleRecords?.() ?? [],
            handles: ctx.handles,
            signal: ctx.signal,
            isToolVisible: ctx.isToolVisible,
            toolPolicy: ctx.toolPolicy,
        }),
};

export const CORE_DATA_TOOLS: RegisteredTool<any>[] = [findToolsTool, runSqlTool, refreshHandleTool];
