'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { SqlResult, StoredSqlResult } from '@/lib/core/entity/assistant/data-handle';
import { RUN_SQL_TOOL_NAME } from '@/lib/core/entity/assistant/tool';
import { errorMessage } from '@/lib/infrastructure/assistant/abort';
import { referencedHandles, type HandleRecord } from '@/lib/infrastructure/assistant/message-selectors';
import { refreshHandle } from '@/lib/infrastructure/assistant/refresh-handle';
import { SQL_MAX_ROWS_FOR_MODEL, SQL_MAX_ROWS_FOR_UI } from '@/lib/infrastructure/assistant/sql-support';
import { isToolError } from '@/lib/infrastructure/assistant/tool-error';
import { ResultTable } from './ResultTable';
import { SqlResultView, type SqlTimelineEntry } from './ActivityTimeline';
import { useLiveHandles, useOptionalDataHandleStore, useRefreshGate, type RefreshGate } from './DataHandleStoreContext';

export interface LiveSqlResultProps {
    entry: SqlTimelineEntry;
    records: HandleRecord[];
}

/** User-facing reason a stale handle cannot be refreshed from here, or undefined when it may be. */
function gateMessage(record: HandleRecord, gate: RefreshGate): string | undefined {
    if (record.toolName === RUN_SQL_TOOL_NAME) return undefined;
    if (gate.isToolVisible?.(record.toolName) === false) return `${record.toolName} is not available to you.`;
    const policy = gate.toolPolicy?.(record.toolName);
    if (policy === 'deny') return `${record.toolName} is turned off in your settings.`;
    if (policy === 'ask') return `Refreshing ${record.name} needs your approval for ${record.toolName}. Ask Rucio bot to refresh it.`;
    return undefined;
}

const hasRows = (result: SqlResult | StoredSqlResult): result is SqlResult => 'rows' in result && Array.isArray(result.rows);

/** A run_sql result wired to the live store: expired badge, Refresh, and full CSV export. Rows are only ever read from the live store. */
export const LiveSqlResult = ({ entry, records }: LiveSqlResultProps) => {
    const store = useOptionalDataHandleStore();
    const gate = useRefreshGate();
    const live = useLiveHandles();
    const [result, setResult] = useState<SqlResult | StoredSqlResult | undefined>(entry.result);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string>();

    const controller = useRef<AbortController | undefined>(undefined);

    // A new result for the same entry replaces local state; an in-flight refresh dies with the component.
    useEffect(() => setResult(entry.result), [entry.result]);
    useEffect(() => () => controller.current?.abort(), []);

    const liveNames = useMemo(() => new Set(live.map(handle => handle.name)), [live]);
    const referenced = useMemo(
        () =>
            referencedHandles(
                entry.sql,
                records.map(record => record.name),
            ),
        [entry.sql, records],
    );

    if (!result) return null;
    if (!store) return <SqlResultView result={result} />;

    const expired = !hasRows(result) || referenced.some(name => !liveNames.has(name));

    const onRefresh = async () => {
        setRefreshing(true);
        setError(undefined);
        controller.current?.abort();
        controller.current = new AbortController();
        const signal = controller.current.signal;
        try {
            const stale = records.filter(record => referenced.includes(record.name) && !liveNames.has(record.name));
            for (const record of stale) {
                const blocked = gateMessage(record, gate);
                if (blocked) {
                    setError(blocked);
                    return;
                }
                const outcome = await refreshHandle(record.name, {
                    records,
                    handles: store,
                    signal,
                    isToolVisible: gate.isToolVisible,
                    toolPolicy: gate.toolPolicy,
                });
                if (isToolError(outcome)) {
                    setError(outcome.message);
                    return;
                }
            }
            const next = await store.query(entry.sql, { maxRows: SQL_MAX_ROWS_FOR_MODEL, signal });
            if (!signal.aborted) setResult(next);
        } catch (cause) {
            setError(errorMessage(cause));
        } finally {
            setRefreshing(false);
        }
    };

    const loadAllRows = async () => (await store.query(entry.sql, { maxRows: SQL_MAX_ROWS_FOR_UI })).rows;

    return (
        <ResultTable
            columns={result.columns}
            rows={hasRows(result) ? result.rows : []}
            totalRows={result.totalRows}
            expired={expired}
            refreshing={refreshing}
            onRefresh={onRefresh}
            loadAllRows={loadAllRows}
            rowsOmitted={!hasRows(result)}
            error={error}
        />
    );
};
