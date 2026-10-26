'use client';

import React, { useMemo, useState } from 'react';
import type { SqlResult, StoredSqlResult } from '@/lib/core/entity/assistant/data-handle';
import { errorMessage } from '@/lib/infrastructure/assistant/abort';
import { referencedHandles, type HandleRecord } from '@/lib/infrastructure/assistant/message-selectors';
import { refreshHandle } from '@/lib/infrastructure/assistant/refresh-handle';
import { SQL_MAX_ROWS_FOR_MODEL, SQL_MAX_ROWS_FOR_UI } from '@/lib/infrastructure/assistant/sql-support';
import { isToolError } from '@/lib/infrastructure/assistant/tool-error';
import { ResultTable } from './ResultTable';
import { SqlResultView, type SqlTimelineEntry } from './ActivityTimeline';
import { useLiveHandles, useOptionalDataHandleStore, useRefreshGate } from './DataHandleStoreContext';

export interface LiveSqlResultProps {
    entry: SqlTimelineEntry;
    records: HandleRecord[];
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
        const signal = new AbortController().signal;
        try {
            const stale = records.filter(record => referenced.includes(record.name) && !liveNames.has(record.name));
            for (const record of stale) {
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
            setResult(await store.query(entry.sql, { maxRows: SQL_MAX_ROWS_FOR_MODEL, signal }));
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
            error={error}
        />
    );
};
