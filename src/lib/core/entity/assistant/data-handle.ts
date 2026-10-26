import type { ToolError } from './tool';

export interface DataHandleProvenance {
    toolName: string;
    args: unknown;
    fetchedAt: string; // ISO
}

export interface DataHandleColumn {
    name: string;
    type: string; // DuckDB type name
}

export interface DataHandle {
    name: string; // DuckDB table name, e.g. 'rules_1'
    provenance: DataHandleProvenance;
    rowCount: number;
    truncated: boolean;
    columns: DataHandleColumn[];
    status: 'live' | 'expired';
    error?: string; // set when the source stream failed part way
}

/** What a rows-producing tool returns to the model. */
export interface RowsToolResult {
    handle: string;
    rowCount: number;
    truncated: boolean;
    columns: string[];
    sample: Record<string, unknown>[]; // at most 3 rows
    error?: ToolError;
}

export interface SqlResult {
    columns: string[];
    rows: Record<string, unknown>[]; // at most maxRows
    totalRows: number;
    savedAs?: string;
}
