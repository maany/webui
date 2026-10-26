import type { DuckDbQueryResult } from './duckdb-engine';

/** Structural view of an apache-arrow Table, so this module needs no direct arrow import. */
export interface ArrowLikeField {
    name: string;
    type: unknown;
}

export interface ArrowLikeTable {
    schema: { fields: ArrowLikeField[] };
    toArray(): Array<{ toJSON(): Record<string, unknown> }>;
}

const isTemporal = (type: unknown): boolean => /^(Date|Timestamp)/.test(String(type));

function toPlain(value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(toPlain);
    if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number | bigint>, toPlain);
    const candidate = value as { toArray?: () => ArrayLike<unknown>; toJSON?: () => unknown };
    if (typeof candidate.toArray === 'function') return Array.from(candidate.toArray(), toPlain);
    if (typeof candidate.toJSON === 'function') {
        const json = candidate.toJSON();
        if (json !== value) return toPlain(json);
    }
    if (typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, inner]) => [key, toPlain(inner)]));
    }
    return String(value);
}

/** Converts an arrow result into plain JSON-safe rows. Date and timestamp columns become ISO strings. */
export function arrowTableToRows(table: ArrowLikeTable): DuckDbQueryResult {
    const fields = table.schema.fields;
    const temporal = new Set(fields.filter(field => isTemporal(field.type)).map(field => field.name));
    const rows = table.toArray().map(row => {
        const json = row.toJSON();
        const out: Record<string, unknown> = {};
        for (const field of fields) {
            const value = json[field.name];
            if (temporal.has(field.name) && typeof value === 'number') out[field.name] = new Date(value).toISOString();
            else out[field.name] = toPlain(value);
        }
        return out;
    });
    return { columns: fields.map(field => field.name), rows };
}
