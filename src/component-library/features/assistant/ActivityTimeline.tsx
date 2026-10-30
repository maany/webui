'use client';

import React, { useEffect, useId, useState } from 'react';
import { HiChevronDown } from 'react-icons/hi';
import type { ChatMessage, MessagePart, ToolCallStatus } from '@/lib/core/entity/assistant/conversation';
import type { SqlResult, StoredSqlResult } from '@/lib/core/entity/assistant/data-handle';

import { isStoredSqlResult } from '@/lib/infrastructure/assistant/conversation-tool-state';
import { isInvalidArgsMarker } from '@/lib/infrastructure/assistant/tanstack-tools';
import { getTool } from '@/lib/infrastructure/assistant/tool-registry';
import { Badge } from '@/component-library/atoms/misc/Badge';
import { JSONViewer } from '@/component-library/features/json/JSONViewer';
import { cn } from '@/component-library/utils';
import { RUN_SQL_TOOL_NAME, type ToolError } from '@/lib/core/entity/assistant/tool';
import { activityLabel, summarizeActivity } from './format';
import { ResultTable } from './ResultTable';

type ToolCallPart = Extract<MessagePart, { type: 'tool-call' }>;

export interface SqlTimelineEntry {
    toolCallId: string;
    sql: string;
    saveAs?: string;
    /** The live result, or the stored copy of a reopened conversation (columns and totals, no rows). */
    result?: SqlResult | StoredSqlResult;
    error?: ToolError;
}

export interface ActivityTimelineProps {
    /** The assistant message of one turn; its parts and usage drive the line and the entries. */
    message: ChatMessage;
    detail: 'compact' | 'verbose';
    renderSqlResult?: (entry: SqlTimelineEntry) => React.ReactNode;
}

const STATUS_VARIANT: Record<ToolCallStatus, 'success' | 'error' | 'warning' | 'info' | 'neutral'> = {
    'awaiting-approval': 'warning',
    running: 'info',
    done: 'success',
    error: 'error',
    denied: 'error',
    expired: 'neutral',
};

const STATUS_LABEL: Record<ToolCallStatus, string> = {
    'awaiting-approval': 'Waiting',
    running: 'Running',
    done: 'Done',
    error: 'Failed',
    denied: 'Denied',
    expired: 'Expired',
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function isSqlResult(value: unknown): value is SqlResult {
    return isRecord(value) && Array.isArray(value.columns) && Array.isArray(value.rows) && typeof value.totalRows === 'number';
}

export function toSqlEntry(part: ToolCallPart): SqlTimelineEntry {
    const args = isRecord(part.args) ? part.args : {};
    return {
        toolCallId: part.toolCallId,
        sql: typeof args.sql === 'string' ? args.sql : '',
        saveAs:
            typeof args.save_as === 'string'
                ? args.save_as
                : isRecord(part.result) && typeof part.result.savedAs === 'string'
                ? part.result.savedAs
                : undefined,
        result: isSqlResult(part.result) || isStoredSqlResult(part.result) ? part.result : undefined,
        error: part.error,
    };
}

function describeCall(part: ToolCallPart): string {
    if (isInvalidArgsMarker(part.args)) return `Run ${part.toolName} (invalid arguments)`;
    const tool = getTool(part.toolName);
    if (!tool) return part.toolName;
    try {
        return tool.spec.describeCall(part.args);
    } catch {
        return part.toolName;
    }
}

/** Tool call durations keep one decimal ("1.2 s"); 1b's formatDuration rounds to whole seconds for the summary line. */
const formatToolDuration = (ms: number): string => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

const json = (value: unknown): string => JSON.stringify(value ?? {}, null, 2) ?? '';

/** The default rendering of a SQL result; a stored result has columns and totals but no rows. */
export const SqlResultView = ({ result }: { result: SqlResult | StoredSqlResult }) =>
    'rows' in result && Array.isArray(result.rows) ? (
        <ResultTable columns={result.columns} rows={result.rows} totalRows={result.totalRows} />
    ) : (
        <p className="text-neutral-500">{`Rows not stored (${result.totalRows.toLocaleString('en-US')} rows). Run the query again to see them.`}</p>
    );

const ToolEntry = ({ part, renderSqlResult }: { part: ToolCallPart; renderSqlResult?: ActivityTimelineProps['renderSqlResult'] }) => {
    const entry = part.toolName === RUN_SQL_TOOL_NAME ? toSqlEntry(part) : undefined;
    return (
        <li className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-neutral-900 dark:text-neutral-100">{part.toolName}</span>
                <Badge size="sm" variant={STATUS_VARIANT[part.status]} value={STATUS_LABEL[part.status]} />
                {part.durationMs !== undefined && <span className="text-neutral-500">{formatToolDuration(part.durationMs)}</span>}
            </div>
            <span className="text-neutral-700 dark:text-neutral-300">{describeCall(part)}</span>
            {entry ? (
                <>
                    <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-neutral-100 p-2 font-mono text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
                        {entry.sql}
                    </pre>
                    {entry.result && !entry.error && (renderSqlResult ? renderSqlResult(entry) : <SqlResultView result={entry.result} />)}
                </>
            ) : (
                <>
                    <span className="text-neutral-500">Arguments</span>
                    <JSONViewer value={json(part.args)} mode="static" showRawToggle={false} maxHeight="200px" />
                    {part.result !== undefined && (
                        <>
                            <span className="text-neutral-500">Result</span>
                            <JSONViewer value={json(part.result)} maxHeight="300px" />
                        </>
                    )}
                </>
            )}
            {part.error && <JSONViewer value={json(part.error)} mode="static" showRawToggle={false} />}
        </li>
    );
};

/** The collapsed activity line of one assistant turn, expandable into reasoning, tool calls and SQL results. */
export const ActivityTimeline = ({ message, detail, renderSqlResult }: ActivityTimelineProps) => {
    const [open, setOpen] = useState(detail === 'verbose');
    useEffect(() => setOpen(detail === 'verbose'), [detail]);
    const panelId = useId();

    const parts = message.parts;
    const line = activityLabel(summarizeActivity(message));
    const entries = parts.filter(
        (part): part is ToolCallPart | Extract<MessagePart, { type: 'reasoning' }> => part.type === 'tool-call' || part.type === 'reasoning',
    );
    const failed = parts.filter(
        (part): part is ToolCallPart =>
            part.type === 'tool-call' && (part.error !== undefined || part.status === 'error' || part.status === 'denied'),
    );
    if (line === '' && entries.length === 0) return null;

    return (
        <div className="flex flex-col gap-1 text-xs" data-testid="assistant-activity">
            <button
                type="button"
                aria-expanded={open}
                aria-controls={open ? panelId : undefined}
                onClick={() => setOpen(value => !value)}
                className="flex items-center gap-1 self-start rounded px-1 py-0.5 text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
                <HiChevronDown aria-hidden="true" className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
                <span>{line || 'Activity'}</span>
            </button>
            {failed.map(part => (
                <p key={`failed-${part.toolCallId}`} role="alert" className="text-base-error-600 dark:text-base-error-400">
                    {`${part.toolName} failed: ${part.error?.message ?? STATUS_LABEL[part.status]}`}
                </p>
            ))}
            {open && (
                <ol id={panelId} className="flex flex-col gap-3 border-l border-neutral-200 pl-3 dark:border-neutral-800">
                    {entries.map((part, index) =>
                        part.type === 'reasoning' ? (
                            <li key={`reasoning-${index}`} className="whitespace-pre-wrap italic text-neutral-600 dark:text-neutral-400">
                                {part.text}
                            </li>
                        ) : (
                            <ToolEntry key={part.toolCallId} part={part} renderSqlResult={renderSqlResult} />
                        ),
                    )}
                </ol>
            )}
        </div>
    );
};
