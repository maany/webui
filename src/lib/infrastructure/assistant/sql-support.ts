import type { SqlResult } from '@/lib/core/entity/assistant/data-handle';
import type { ToolError } from '@/lib/core/entity/assistant/tool';
import { errorMessage, isAbortError } from '@/lib/infrastructure/assistant/abort';
import { DataHandleStoreError } from '@/lib/infrastructure/assistant/duckdb/duckdb-data-handle-store';
import type { HandleRecord } from '@/lib/infrastructure/assistant/message-selectors';
import { toolError } from '@/lib/infrastructure/assistant/tool-error';

/** Rows of a query result the model sees. */
export const SQL_MAX_ROWS_FOR_MODEL = 200;
/** Rows the result table loads for CSV export. */
export const SQL_MAX_ROWS_FOR_UI = 10_000;

/** Turns a store or DuckDB error into a tool error the model can act on. */
export function sqlErrorToToolError(error: unknown, records: HandleRecord[], liveNames: string[]): ToolError {
    if (isAbortError(error)) return toolError('aborted', 'Stopped by the user');
    if (error instanceof DataHandleStoreError) return toolError(error.code === 'unavailable' ? 'unavailable' : 'invalid_args', error.message);
    const message = errorMessage(error);
    const missing = /Table with name ([A-Za-z0-9_]+) does not exist/i.exec(message);
    if (missing) {
        const name = missing[1];
        if (records.some(record => record.name === name)) {
            return toolError('not_found', `Handle ${name} has expired. Call refresh_handle with handle "${name}", then run the query again.`);
        }
        return toolError('not_found', `There is no handle named ${name}. Live handles: ${liveNames.join(', ') || 'none'}.`);
    }
    return toolError('invalid_args', message);
}

/** Largest serialized SqlResult handed to the model; keeps it under the 20k stored-result trim. */
export const SQL_MAX_RESULT_CHARS = 16_000;

/** Drops rows from the end until the result fits, and records how many rows are still shown. */
export function capSqlResultForModel(result: SqlResult, maxChars: number = SQL_MAX_RESULT_CHARS): SqlResult {
    if (JSON.stringify(result).length <= maxChars) return result;
    let rows = result.rows;
    let low = 0;
    let high = rows.length;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (JSON.stringify({ ...result, rows: rows.slice(0, mid), rowsShown: mid }).length <= maxChars) low = mid;
        else high = mid - 1;
    }
    rows = rows.slice(0, low);
    return { ...result, rows, rowsShown: rows.length };
}
