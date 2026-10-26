'use client';

import React, { useState } from 'react';
import { Button } from '@/component-library/atoms/form/button';
import { Badge } from '@/component-library/atoms/misc/Badge';
import { downloadCsv, toCsv } from '@/lib/infrastructure/assistant/csv';

export interface ResultTableProps {
    columns: string[];
    rows: Record<string, unknown>[] | undefined;
    totalRows: number;
    maxVisibleRows?: number;
    expired?: boolean;
    refreshing?: boolean;
    onRefresh?: () => void;
    /** Loads the full result for CSV export; when absent or expired the export uses `rows`. */
    loadAllRows?: () => Promise<Record<string, unknown>[]>;
    fileName?: string;
    error?: string;
}

const MAX_CELL_CHARS = 120;

export const formatCell = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
};

export const ResultTable = ({
    columns,
    rows: rowsProp,
    totalRows,
    maxVisibleRows = 50,
    expired = false,
    refreshing = false,
    onRefresh,
    loadAllRows,
    fileName = 'rucio-bot-result.csv',
    error,
}: ResultTableProps) => {
    const rows = rowsProp ?? [];
    const [exporting, setExporting] = useState(false);
    const visible = rows.slice(0, maxVisibleRows);

    const exportCsv = async () => {
        setExporting(true);
        try {
            const all = !expired && loadAllRows ? await loadAllRows() : rows;
            downloadCsv(fileName, toCsv(columns, all));
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="flex flex-col gap-2 text-xs" data-testid="assistant-result-table">
            <div className="flex flex-wrap items-center gap-2">
                {expired && <Badge variant="warning" size="sm" value="Expired" />}
                <span className="text-neutral-600 dark:text-neutral-400">{`Showing ${visible.length} of ${totalRows.toLocaleString(
                    'en-US',
                )} rows`}</span>
                <div className="ml-auto flex gap-2">
                    {expired && onRefresh && (
                        <Button size="sm" variant="neutral" onClick={onRefresh} loading={refreshing}>
                            Refresh
                        </Button>
                    )}
                    <Button size="sm" variant="neutral" onClick={exportCsv} loading={exporting} disabled={columns.length === 0}>
                        Export CSV
                    </Button>
                </div>
            </div>
            {error && (
                <p role="alert" className="text-base-error-600 dark:text-base-error-400">
                    {error}
                </p>
            )}
            <div className="max-h-80 overflow-auto rounded border border-neutral-200 dark:border-neutral-800">
                <table className="w-full border-collapse text-left">
                    <thead className="sticky top-0 bg-neutral-100 dark:bg-neutral-800">
                        <tr>
                            {columns.map(column => (
                                <th
                                    key={column}
                                    scope="col"
                                    className="whitespace-nowrap px-2 py-1 font-medium text-neutral-900 dark:text-neutral-100"
                                >
                                    {column}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {visible.map((row, index) => (
                            <tr key={index} className="border-t border-neutral-200 dark:border-neutral-800">
                                {columns.map(column => {
                                    const cell = formatCell(row[column]);
                                    const long = cell.length > MAX_CELL_CHARS;
                                    return (
                                        <td
                                            key={column}
                                            title={long ? cell : undefined}
                                            className="px-2 py-1 align-top text-neutral-800 dark:text-neutral-200"
                                        >
                                            {long ? `${cell.slice(0, MAX_CELL_CHARS)}…` : cell}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                        {visible.length === 0 && (
                            <tr>
                                <td colSpan={Math.max(1, columns.length)} className="px-2 py-2 text-neutral-500">
                                    No rows
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
