import { RUN_SQL_TOOL_NAME } from '@/lib/core/entity/assistant/tool';
import type { DataHandle, DataHandleColumn, DataHandleProvenance, SqlResult } from '@/lib/core/entity/assistant/data-handle';
import type { AssistantDataHandleStorePort, IngestRowsOptions } from '@/lib/core/port/secondary/assistant-data-handle-store-port';
import { checkReadOnlySql } from '@/lib/core/services/assistant-sql-guard';
import { abortError, errorMessage } from '@/lib/infrastructure/assistant/abort';
import { ENGINE_INIT_SQL, type DuckDbEngine, type DuckDbEngineFactory } from './duckdb-engine';
import { normalizeRows } from './row-normalizer';

export const DEFAULT_IDLE_MS = 10 * 60 * 1000;
export const HANDLE_NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

export type DataHandleStoreErrorCode = 'invalid_sql' | 'invalid_name' | 'unavailable';

export class DataHandleStoreError extends Error {
    constructor(public readonly code: DataHandleStoreErrorCode, message: string) {
        super(message);
        this.name = 'DataHandleStoreError';
    }
}

/** "List-Rules!" -> "list_rules"; names that do not start with a letter get a "t_" prefix. */
export function tableBaseName(baseName: string): string {
    const cleaned = baseName
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40);
    if (cleaned === '') return 't';
    return /^[a-z]/.test(cleaned) ? cleaned : `t_${cleaned}`;
}

const quote = (name: string): string => `"${name}"`;

export interface DuckDbDataHandleStoreOptions {
    idleMs?: number;
    now?: () => Date;
}

/** AssistantDataHandleStorePort on DuckDB. One table per handle; every engine call runs one at a time. */
export class DuckDbDataHandleStore implements AssistantDataHandleStorePort {
    private engine: Promise<DuckDbEngine> | undefined;
    private readonly handles = new Map<string, DataHandle>();
    private snapshot: DataHandle[] = [];
    private readonly counters = new Map<string, number>();
    private readonly listeners = new Set<() => void>();
    private chain: Promise<unknown> = Promise.resolve();
    private idleTimer: ReturnType<typeof setTimeout> | undefined;
    private readonly idleMs: number;
    private readonly now: () => Date;

    constructor(private readonly factory: DuckDbEngineFactory, options: DuckDbDataHandleStoreOptions = {}) {
        this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
        this.now = options.now ?? (() => new Date());
    }

    async ingestRows(
        baseName: string,
        provenance: DataHandleProvenance,
        rows: AsyncIterable<Record<string, unknown>>,
        options: IngestRowsOptions,
    ): Promise<DataHandle> {
        const { rowCap, signal } = options;
        if (signal?.aborted) throw abortError();
        if (options.name !== undefined && !HANDLE_NAME_PATTERN.test(options.name)) {
            throw new DataHandleStoreError('invalid_name', `"${options.name}" is not a valid handle name`);
        }

        const buffer: Record<string, unknown>[] = [];
        let truncated = false;
        for await (const row of rows) {
            if (signal?.aborted) throw abortError();
            if (buffer.length >= rowCap) {
                truncated = true;
                break;
            }
            buffer.push(row);
        }
        if (signal?.aborted) throw abortError();

        const sourceError = options.sourceError?.();
        const name = options.name ?? this.nextName(baseName);
        const columns = await this.serialized(async engine => {
            await engine.exec(`DROP TABLE IF EXISTS ${quote(name)}`);
            if (buffer.length === 0) {
                await engine.exec(`CREATE TABLE ${quote(name)} AS SELECT NULL::VARCHAR AS _empty WHERE false`);
                return [];
            }
            await engine.insertJSON(name, JSON.stringify(normalizeRows(buffer)));
            return this.describe(engine, name);
        });

        const handle: DataHandle = {
            name,
            provenance,
            rowCount: buffer.length,
            truncated: truncated || sourceError !== undefined,
            columns,
            status: 'live',
            ...(sourceError !== undefined ? { error: sourceError } : {}),
        };
        this.handles.set(name, handle);
        this.publish();
        return handle;
    }

    async query(sql: string, options: { maxRows: number; saveAs?: string; signal?: AbortSignal }): Promise<SqlResult> {
        const { maxRows, saveAs, signal } = options;
        if (signal?.aborted) throw abortError();
        const guard = checkReadOnlySql(sql);
        if (!guard.ok) throw new DataHandleStoreError('invalid_sql', guard.reason);
        if (saveAs !== undefined) {
            if (!HANDLE_NAME_PATTERN.test(saveAs)) {
                throw new DataHandleStoreError('invalid_name', `save_as must be lower case letters, digits and underscores, starting with a letter`);
            }
            const existing = this.handles.get(saveAs);
            if (existing && existing.provenance.toolName !== RUN_SQL_TOOL_NAME) {
                throw new DataHandleStoreError('invalid_name', `"${saveAs}" holds fetched data. Pick another name for save_as.`);
            }
        }
        const limit = Math.max(0, Math.floor(maxRows));
        const statement = guard.statement;

        const outcome = await this.serialized(async engine => {
            if (saveAs !== undefined) {
                await engine.exec(`CREATE OR REPLACE TABLE ${quote(saveAs)} AS SELECT * FROM (${statement}) AS _q`);
                const savedColumns = await this.describe(engine, saveAs);
                const totalRows = await this.count(engine, `SELECT count(*) AS n FROM ${quote(saveAs)}`, signal);
                const page = await engine.query(`SELECT * FROM ${quote(saveAs)} LIMIT ${limit}`, signal);
                return { page, totalRows, savedColumns };
            }
            const totalRows = await this.count(engine, `SELECT count(*) AS n FROM (${statement}) AS _q`, signal);
            const page = await engine.query(`SELECT * FROM (${statement}) AS _q LIMIT ${limit}`, signal);
            return { page, totalRows, savedColumns: undefined };
        });

        if (saveAs !== undefined && outcome.savedColumns) {
            this.handles.set(saveAs, {
                name: saveAs,
                provenance: { toolName: RUN_SQL_TOOL_NAME, args: { sql, save_as: saveAs }, fetchedAt: this.now().toISOString() },
                rowCount: outcome.totalRows,
                truncated: false,
                columns: outcome.savedColumns,
                status: 'live',
            });
            this.publish();
        }
        return {
            columns: outcome.page.columns,
            rows: outcome.page.rows,
            totalRows: outcome.totalRows,
            ...(saveAs !== undefined ? { savedAs: saveAs } : {}),
        };
    }

    listHandles(): DataHandle[] {
        return this.snapshot;
    }

    async drop(name: string): Promise<void> {
        const known = this.handles.delete(name);
        if (known) this.publish();
        if (this.engine) await this.serialized(engine => engine.exec(`DROP TABLE IF EXISTS ${quote(name)}`));
    }

    async dropAll(): Promise<void> {
        const names = Array.from(this.handles.keys());
        this.handles.clear();
        this.counters.clear();
        this.publish();
        if (!this.engine || names.length === 0) return;
        await this.serialized(async engine => {
            for (const name of names) await engine.exec(`DROP TABLE IF EXISTS ${quote(name)}`);
        });
    }

    async memoryBytes(): Promise<number> {
        if (!this.engine) return 0;
        return this.serialized(
            engine => this.count(engine, 'SELECT CAST(COALESCE(sum(memory_usage_bytes), 0) AS DOUBLE) AS n FROM duckdb_memory()'),
            false,
        );
    }

    async terminate(): Promise<void> {
        this.clearIdle();
        const pending = this.engine;
        this.engine = undefined;
        this.handles.clear();
        this.counters.clear();
        this.publish();
        if (!pending) return;
        try {
            const engine = await pending;
            await engine.terminate();
        } catch {
            // The engine never started or is already gone.
        }
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private nextName(baseName: string): string {
        const base = tableBaseName(baseName);
        let n = this.counters.get(base) ?? 0;
        let name: string;
        do {
            n += 1;
            name = `${base}_${n}`;
        } while (this.handles.has(name));
        this.counters.set(base, n);
        return name;
    }

    private async describe(engine: DuckDbEngine, name: string): Promise<DataHandleColumn[]> {
        const result = await engine.query(`DESCRIBE ${quote(name)}`);
        return result.rows.map(row => ({ name: String(row.column_name), type: String(row.column_type) }));
    }

    private async count(engine: DuckDbEngine, sql: string, signal?: AbortSignal): Promise<number> {
        const result = await engine.query(sql, signal);
        return Number(result.rows[0]?.n ?? 0);
    }

    private publish(): void {
        this.snapshot = Array.from(this.handles.values());
        this.listeners.forEach(listener => listener());
    }

    private getEngine(): Promise<DuckDbEngine> {
        if (!this.engine) {
            const starting = (async () => {
                let engine: DuckDbEngine;
                try {
                    engine = await this.factory();
                } catch (error) {
                    throw new DataHandleStoreError('unavailable', `The SQL scratchpad could not start: ${errorMessage(error)}`);
                }
                try {
                    for (const statement of ENGINE_INIT_SQL) await engine.exec(statement);
                } catch (error) {
                    await engine.terminate().catch(() => undefined);
                    throw new DataHandleStoreError('unavailable', `The SQL scratchpad could not be secured: ${errorMessage(error)}`);
                }
                return engine;
            })();
            this.engine = starting;
            starting.catch(() => {
                if (this.engine === starting) this.engine = undefined;
            });
        }
        return this.engine;
    }

    private serialized<T>(work: (engine: DuckDbEngine) => Promise<T>, touch = true): Promise<T> {
        const run = this.chain.then(async () => {
            const engine = await this.getEngine();
            if (touch) this.clearIdle();
            try {
                return await work(engine);
            } finally {
                if (touch) this.armIdle();
            }
        });
        this.chain = run.catch(() => undefined);
        return run;
    }

    private armIdle(): void {
        this.clearIdle();
        this.idleTimer = setTimeout(() => {
            void this.terminate();
        }, this.idleMs);
    }

    private clearIdle(): void {
        if (this.idleTimer !== undefined) {
            clearTimeout(this.idleTimer);
            this.idleTimer = undefined;
        }
    }
}
