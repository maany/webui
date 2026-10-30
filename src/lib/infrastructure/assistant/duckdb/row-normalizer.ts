type ValueKind = 'number' | 'boolean' | 'string' | 'json';

interface Cell {
    kind: ValueKind;
    value: unknown;
}

const NULL_CELL = null;

function jsonText(value: unknown): string {
    try {
        return JSON.stringify(value, (_key, inner) => (typeof inner === 'bigint' ? inner.toString() : inner)) ?? 'null';
    } catch {
        return String(value);
    }
}

/** Classifies a value; null means the cell is stored as null. */
function toCell(value: unknown): Cell | null {
    if (value === null || value === undefined) return NULL_CELL;
    switch (typeof value) {
        case 'number':
            return Number.isFinite(value) ? { kind: 'number', value } : NULL_CELL;
        case 'boolean':
            return { kind: 'boolean', value };
        case 'string':
            return { kind: 'string', value };
        case 'bigint': {
            const asNumber = Number(value);
            return Number.isSafeInteger(asNumber) ? { kind: 'number', value: asNumber } : { kind: 'string', value: String(value) };
        }
        case 'function':
        case 'symbol':
            return NULL_CELL;
        default:
            if (value instanceof Date) {
                return Number.isNaN(value.getTime()) ? NULL_CELL : { kind: 'string', value: value.toISOString() };
            }
            return { kind: 'json', value };
    }
}

function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/**
 * Makes rows safe for DuckDB's JSON reader, which infers one type per column from the first values and fails on
 * mixed types. Every row gets every column (missing values become null). Columns that hold objects, arrays or
 * mixed scalar types become text: strings stay as they are, everything else is JSON encoded.
 */
export function normalizeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    const kinds = new Map<string, Set<ValueKind>>();
    const cells = rows.map(row => {
        const rowCells = new Map<string, Cell | null>();
        for (const [key, value] of Object.entries(row)) {
            const cell = toCell(value);
            rowCells.set(key, cell);
            let set = kinds.get(key);
            if (!set) {
                set = new Set<ValueKind>();
                kinds.set(key, set);
            }
            if (cell) set.add(cell.kind);
        }
        return rowCells;
    });
    const keys = Array.from(kinds.keys());
    const asText = new Set(
        keys.filter(key => {
            const set = kinds.get(key) as Set<ValueKind>;
            return set.size > 1 || set.has('json');
        }),
    );
    return cells.map(rowCells => {
        const out: Record<string, unknown> = {};
        for (const key of keys) {
            const cell = rowCells.get(key) ?? null;
            if (!cell) setOwn(out, key, null);
            else if (asText.has(key)) setOwn(out, key, typeof cell.value === 'string' ? cell.value : jsonText(cell.value));
            else setOwn(out, key, cell.value);
        }
        return out;
    });
}
