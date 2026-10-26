import type { DuckDbEngine, DuckDbQueryResult } from '@/lib/infrastructure/assistant/duckdb/duckdb-engine';

const TABLE = '"([a-z0-9_]+)"';

function columnType(value: unknown): string {
    if (typeof value === 'number') return 'DOUBLE';
    if (typeof value === 'boolean') return 'BOOLEAN';
    return 'VARCHAR';
}

/**
 * In-memory stand-in for DuckDB that understands exactly the statements DuckDbDataHandleStore sends.
 * `statementResults` maps a user statement (as passed to query()) to the rows it should return.
 */
export class FakeDuckDbEngine implements DuckDbEngine {
    readonly executed: string[] = [];
    readonly tables = new Map<string, Record<string, unknown>[]>();
    readonly statementResults = new Map<string, Record<string, unknown>[]>();
    memory = 4096;
    terminated = false;
    failNext: Error | undefined;
    /** When set, insertJSON waits for it before inserting (lets tests hold an ingest in flight). */
    insertGate: Promise<void> | undefined;
    failInsert: Error | undefined;

    async exec(sql: string): Promise<void> {
        this.executed.push(sql);
        this.throwIfFailing();
        const drop = new RegExp(`^DROP TABLE IF EXISTS ${TABLE}$`).exec(sql);
        if (drop) {
            this.tables.delete(drop[1]);
            return;
        }
        const empty = new RegExp(`^CREATE TABLE ${TABLE} AS SELECT NULL::VARCHAR AS _empty WHERE false$`).exec(sql);
        if (empty) {
            this.tables.set(empty[1], []);
            return;
        }
        const replace = new RegExp(`^CREATE OR REPLACE TABLE ${TABLE} AS SELECT \\* FROM \\(([\\s\\S]+)\\) AS _q$`).exec(sql);
        if (replace) {
            this.tables.set(replace[1], this.rowsFor(replace[2]));
        }
    }

    async query(sql: string, signal?: AbortSignal): Promise<DuckDbQueryResult> {
        this.executed.push(sql);
        if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
        this.throwIfFailing();
        const describe = new RegExp(`^DESCRIBE ${TABLE}$`).exec(sql);
        if (describe) {
            const rows = this.table(describe[1]);
            const first = rows[0] ?? {};
            return {
                columns: ['column_name', 'column_type'],
                rows: Object.keys(first).map(key => ({ column_name: key, column_type: columnType(first[key]) })),
            };
        }
        if (sql.includes('duckdb_memory()')) return { columns: ['n'], rows: [{ n: this.memory }] };
        const countTable = new RegExp(`^SELECT count\\(\\*\\) AS n FROM ${TABLE}$`).exec(sql);
        if (countTable) return { columns: ['n'], rows: [{ n: this.table(countTable[1]).length }] };
        const pageTable = new RegExp(`^SELECT \\* FROM ${TABLE} LIMIT (\\d+)$`).exec(sql);
        if (pageTable) return this.page(this.table(pageTable[1]), Number(pageTable[2]));
        const countStatement = /^SELECT count\(\*\) AS n FROM \(([\s\S]+)\) AS _q$/.exec(sql);
        if (countStatement) return { columns: ['n'], rows: [{ n: this.rowsFor(countStatement[1]).length }] };
        const pageStatement = /^SELECT \* FROM \(([\s\S]+)\) AS _q LIMIT (\d+)$/.exec(sql);
        if (pageStatement) return this.page(this.rowsFor(pageStatement[1]), Number(pageStatement[2]));
        throw new Error(`FakeDuckDbEngine cannot answer: ${sql}`);
    }

    async insertJSON(table: string, jsonText: string): Promise<void> {
        this.executed.push(`INSERT JSON ${table}`);
        this.throwIfFailing();
        if (this.insertGate) await this.insertGate;
        if (this.failInsert) {
            const error = this.failInsert;
            this.failInsert = undefined;
            throw error;
        }
        this.tables.set(table, JSON.parse(jsonText));
    }

    async terminate(): Promise<void> {
        this.terminated = true;
    }

    private throwIfFailing(): void {
        if (this.failNext) {
            const error = this.failNext;
            this.failNext = undefined;
            throw error;
        }
    }

    private page(rows: Record<string, unknown>[], limit: number): DuckDbQueryResult {
        const slice = rows.slice(0, limit);
        return { columns: Object.keys(rows[0] ?? {}), rows: slice };
    }

    private table(name: string): Record<string, unknown>[] {
        const rows = this.tables.get(name);
        if (!rows) throw new Error(`Catalog Error: Table with name ${name} does not exist!`);
        return rows;
    }

    private rowsFor(statement: string): Record<string, unknown>[] {
        const scripted = this.statementResults.get(statement.trim());
        if (scripted) return scripted;
        const whole = /^SELECT \* FROM "?([a-z0-9_]+)"?$/i.exec(statement.trim());
        if (whole) return this.table(whole[1]);
        throw new Error(`FakeDuckDbEngine has no result for: ${statement}`);
    }
}

export async function* rowsOf(rows: Record<string, unknown>[], onReturn?: () => void): AsyncGenerator<Record<string, unknown>> {
    try {
        for (const row of rows) yield row;
    } finally {
        onReturn?.();
    }
}
