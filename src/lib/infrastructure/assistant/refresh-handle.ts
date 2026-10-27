import type { RowsToolResult, SqlResult } from '@/lib/core/entity/assistant/data-handle';
import { RUN_SQL_TOOL_NAME, type ToolError, type ToolPolicy } from '@/lib/core/entity/assistant/tool';
import type { AssistantDataHandleStorePort } from '@/lib/core/port/secondary/assistant-data-handle-store-port';
import { executeFeatureTool } from '@/lib/infrastructure/assistant/feature-executor';
import { referencedHandles, type HandleRecord } from '@/lib/infrastructure/assistant/message-selectors';
import { capSqlResultForModel, SQL_MAX_ROWS_FOR_MODEL, sqlErrorToToolError } from '@/lib/infrastructure/assistant/sql-support';
import { isToolError, toolError } from '@/lib/infrastructure/assistant/tool-error';
import { getTool } from '@/lib/infrastructure/assistant/tool-registry';
import type { RegisteredTool } from '@/lib/infrastructure/assistant/tool-types';

export interface RefreshHandleDeps {
    records: HandleRecord[];
    handles: AssistantDataHandleStorePort;
    signal: AbortSignal;
    fetchImpl?: typeof fetch;
    /** `account@vo` the re-run read is sent as; omitted for user-initiated refreshes outside a turn. */
    expectedAccount?: string;
    lookupTool?: (name: string) => RegisteredTool<any> | undefined;
    /** Live visibility check; a tool that is not visible is never re-run. */
    isToolVisible?: (name: string) => boolean;
    /** Live policy; missing means read tools default to allow. */
    toolPolicy?: (name: string) => ToolPolicy;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function findRecord(name: string, deps: RefreshHandleDeps): HandleRecord | undefined {
    const fromTranscript = deps.records.find(record => record.name === name);
    if (fromTranscript) return fromTranscript;
    const live = deps.handles.listHandles().find(handle => handle.name === name);
    return live ? { name: live.name, ...live.provenance } : undefined;
}

/**
 * Re-runs the call that produced a handle and stores the rows under the same name. Saved queries first refresh
 * the handles they read from. Re-running a read never needs approval.
 */
export async function refreshHandle(
    name: string,
    deps: RefreshHandleDeps,
    visiting: Set<string> = new Set(),
): Promise<RowsToolResult | SqlResult | ToolError> {
    if (visiting.has(name)) return toolError('invalid_args', `Handle ${name} depends on itself`);
    visiting.add(name);
    const record = findRecord(name, deps);
    if (!record) {
        const known = Array.from(new Set([...deps.records.map(r => r.name), ...deps.handles.listHandles().map(h => h.name)]));
        return toolError('not_found', `There is no handle named ${name}. Known handles: ${known.join(', ') || 'none'}.`);
    }

    if (record.toolName === RUN_SQL_TOOL_NAME) {
        const sql = isRecord(record.args) && typeof record.args.sql === 'string' ? record.args.sql : '';
        if (sql === '') return toolError('invalid_args', `Handle ${name} has no stored query`);
        const live = new Set(deps.handles.listHandles().map(handle => handle.name));
        const sources = referencedHandles(
            sql,
            deps.records.map(r => r.name),
        ).filter(source => source !== name && !live.has(source));
        for (const source of sources) {
            const refreshed = await refreshHandle(source, deps, visiting);
            if (isToolError(refreshed)) return refreshed;
        }
        try {
            return capSqlResultForModel(await deps.handles.query(sql, { maxRows: SQL_MAX_ROWS_FOR_MODEL, saveAs: name, signal: deps.signal }));
        } catch (error) {
            return sqlErrorToToolError(
                error,
                deps.records,
                deps.handles.listHandles().map(handle => handle.name),
            );
        }
    }

    const tool = (deps.lookupTool ?? getTool)(record.toolName);
    if (!tool || tool.spec.executor !== 'feature')
        return toolError('unavailable', `${record.toolName} is not available, so ${name} cannot be refreshed`);
    if (tool.spec.risk !== 'read') return toolError('forbidden', `${record.toolName} is not a read tool`);
    if (deps.isToolVisible?.(record.toolName) === false) {
        return toolError('forbidden', `${record.toolName} is not available to you, so ${name} cannot be refreshed`);
    }
    const policy = deps.toolPolicy?.(record.toolName) ?? 'allow';
    if (policy === 'deny') return toolError('denied_by_policy', `${record.toolName} is turned off, so ${name} cannot be refreshed`);
    if (policy === 'ask') {
        return toolError(
            'denied_by_policy',
            `${record.toolName} needs the user's approval. Call ${record.toolName} yourself so the user can approve it.`,
        );
    }
    const result = await executeFeatureTool(tool.spec, record.args, {
        signal: deps.signal,
        handles: deps.handles,
        fetchImpl: deps.fetchImpl,
        expectedAccount: deps.expectedAccount,
        tableName: name,
    });
    return result as RowsToolResult | ToolError;
}
