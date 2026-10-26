import { RUN_SQL_TOOL_NAME } from '@/lib/core/entity/assistant/tool';
import type { DataHandle, DataHandleColumn, DataHandleProvenance, SqlResult } from '@/lib/core/entity/assistant/data-handle';
import type { AssistantDataHandleStorePort, IngestRowsOptions } from '@/lib/core/port/secondary/assistant-data-handle-store-port';
import { checkReadOnlySql } from '@/lib/core/services/assistant-sql-guard';
import { abortError } from '@/lib/infrastructure/assistant/abort';
import { ENGINE_INIT_SQL, type DuckDbEngine, type DuckDbEngineFactory, type DuckDbQueryResult } from './duckdb-engine';
import { normalizeRows } from './row-normalizer';

export const DEFAULT_IDLE_MS = 10 * 60 * 1000;
/** Fallback for a non-finite or negative maxRows; the model sees at most 200 SQL rows. */
export const DEFAULT_MAX_ROWS = 200;
/** Fallback for a non-finite or negative rowCap; the low-memory cap, the usual default comes from defaultRowCap(). */
export const DEFAULT_ROW_CAP = 10_000;
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

/** Non-finite or negative values fall back to the default; fractions are floored. */
function positiveInt(value: number, fallback: number): number {
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
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
    /** Bumped by dropAll and terminate; work started before a bump must not register handles afterwards. */
    private generation = 0;
    /** Ingests currently reading their row source. */
    private reading = 0;
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
        // Reading a slow source happens before the queue; idle termination must not cut in on it.
        this.reading += 1;
        try {
            return await this.ingest(baseName, provenance, rows, options);
        } finally {
            this.reading -= 1;
            if (this.reading === 0 && this.engine) this.armIdle();
        }
    }

    private async ingest(
        baseName: string,
        provenance: DataHandleProvenance,
        rows: AsyncIterable<Record<string, unknown>>,
        options: IngestRowsOptions,
    ): Promise<DataHandle> {
        const { signal } = options;
        const rowCap = positiveInt(options.rowCap, DEFAULT_ROW_CAP);
        const generation = this.generation;
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
        return this.serialized(
            async engine => {
                this.throwIfStale(generation, signal);
                let columns: DataHandleColumn[];
                try {
                    await engine.exec(`DROP TABLE IF EXISTS ${quote(name)}`, signal);
                    if (buffer.length === 0) {
                        await engine.exec(`CREATE TABLE ${quote(name)} AS SELECT NULL::VARCHAR AS _empty WHERE false`, signal);
                        columns = [];
                    } else {
                        await engine.insertJSON(name, JSON.stringify(normalizeRows(buffer)), signal);
                        columns = await this.describe(engine, name);
                    }
                } catch (error) {
                    // A refresh replaced the table, so the old handle no longer describes anything.
                    await this.discardTable(engine, name, generation);
                    throw error;
                }
                await this.throwIfStaleAndDrop(engine, name, generation, signal);

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
            },
            true,
            generation,
        );
    }

    async query(sql: string, options: { maxRows: number; saveAs?: string; signal?: AbortSignal }): Promise<SqlResult> {
        const { saveAs, signal } = options;
        const generation = this.generation;
        if (signal?.aborted) throw abortError();
        const guard = checkReadOnlySql(sql);
        if (!guard.ok) throw new DataHandleStoreError('invalid_sql', guard.reason);
        if (saveAs !== undefined) this.checkSaveAs(saveAs);
        const limit = positiveInt(options.maxRows, DEFAULT_MAX_ROWS);
        const statement = guard.statement;

        return this.serialized(
            async engine => {
                this.throwIfStale(generation, signal);
                if (saveAs !== undefined) {
                    // The handle map may have changed while this call waited in the queue.
                    this.checkSaveAs(saveAs);
                    await engine.exec(`CREATE OR REPLACE TABLE ${quote(saveAs)} AS SELECT * FROM (${statement}) AS _q`, signal);
                    let savedColumns: DataHandleColumn[];
                    let totalRows: number;
                    let page: DuckDbQueryResult;
                    try {
                        savedColumns = await this.describe(engine, saveAs);
                        totalRows = await this.count(engine, `SELECT count(*) AS n FROM ${quote(saveAs)}`, signal);
                        page = await engine.query(`SELECT * FROM ${quote(saveAs)} LIMIT ${limit}`, signal);
                    } catch (error) {
                        await this.discardTable(engine, saveAs, generation);
                        throw error;
                    }
                    await this.throwIfStaleAndDrop(engine, saveAs, generation, signal);
                    this.handles.set(saveAs, {
                        name: saveAs,
                        provenance: { toolName: RUN_SQL_TOOL_NAME, args: { sql, save_as: saveAs }, fetchedAt: this.now().toISOString() },
                        rowCount: totalRows,
                        truncated: false,
                        columns: savedColumns,
                        status: 'live',
                    });
                    this.publish();
                    return { columns: page.columns, rows: page.rows, totalRows, savedAs: saveAs };
                }
                const totalRows = await this.count(engine, `SELECT count(*) AS n FROM (${statement}) AS _q`, signal);
                const page = await engine.query(`SELECT * FROM (${statement}) AS _q LIMIT ${limit}`, signal);
                return { columns: page.columns, rows: page.rows, totalRows };
            },
            true,
            generation,
        );
    }

    listHandles(): DataHandle[] {
        return this.snapshot;
    }

    async drop(name: string): Promise<void> {
        if (!HANDLE_NAME_PATTERN.test(name)) throw new DataHandleStoreError('invalid_name', `"${name}" is not a valid handle name`);
        const known = this.handles.delete(name);
        if (known) this.publish();
        if (this.engine) await this.serialized(engine => engine.exec(`DROP TABLE IF EXISTS ${quote(name)}`));
    }

    async dropAll(): Promise<void> {
        this.generation += 1;
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
        this.generation += 1;
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

    /** Called by an engine that terminated itself. Only acts if that engine is still the current one. */
    async terminateEngine(dead: DuckDbEngine): Promise<void> {
        const pending = this.engine;
        if (!pending) return;
        const current = await pending.catch(() => undefined);
        if (current !== dead || this.engine !== pending) return;
        await this.terminate();
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private checkSaveAs(saveAs: string): void {
        if (!HANDLE_NAME_PATTERN.test(saveAs)) {
            throw new DataHandleStoreError('invalid_name', 'save_as must be lower case letters, digits and underscores, starting with a letter');
        }
        const existing = this.handles.get(saveAs);
        if (existing && existing.provenance.toolName !== RUN_SQL_TOOL_NAME) {
            throw new DataHandleStoreError('invalid_name', `"${saveAs}" holds fetched data. Pick another name for save_as.`);
        }
    }

    private throwIfStale(generation: number, signal?: AbortSignal): void {
        if (signal?.aborted || generation !== this.generation) throw abortError();
    }

    /** After the table exists: if the call was aborted or the store was cleared meanwhile, drop the table and reject. */
    private async throwIfStaleAndDrop(engine: DuckDbEngine, name: string, generation: number, signal?: AbortSignal): Promise<void> {
        if (!signal?.aborted && generation === this.generation) return;
        await this.discardTable(engine, name, generation);
        throw abortError();
    }

    /** Drops a table this call created or replaced, and forgets its handle so none stays live without a table. */
    private async discardTable(engine: DuckDbEngine, name: string, generation: number): Promise<void> {
        await engine.exec(`DROP TABLE IF EXISTS ${quote(name)}`).catch(() => undefined);
        if (generation === this.generation && this.handles.delete(name)) this.publish();
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
                } catch {
                    throw new DataHandleStoreError('unavailable', 'The SQL scratchpad could not start');
                }
                try {
                    for (const statement of ENGINE_INIT_SQL) await engine.exec(statement);
                } catch {
                    await engine.terminate().catch(() => undefined);
                    throw new DataHandleStoreError('unavailable', 'The SQL scratchpad could not start');
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

    private serialized<T>(work: (engine: DuckDbEngine) => Promise<T>, touch = true, generation?: number): Promise<T> {
        const run = this.chain.then(async () => {
            // Stale work must not boot a fresh engine just to reject.
            if (generation !== undefined && generation !== this.generation) throw abortError();
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
            // A reading ingest re-arms the timer when it finishes.
            if (this.reading > 0) return;
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
