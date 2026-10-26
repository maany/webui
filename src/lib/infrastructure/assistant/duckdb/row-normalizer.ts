type ValueKind = 'number' | 'boolean' | 'string' | 'json';

function kindOf(value: unknown): ValueKind {
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'string') return 'string';
    return 'json';
}

/**
 * Makes rows safe for DuckDB's JSON reader, which infers one type per column from the first values and fails on
 * mixed types. Every row gets every column (missing values become null). Columns that hold objects, arrays or
 * mixed scalar types become text: strings stay as they are, everything else is JSON encoded.
 */
export function normalizeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    const kinds = new Map<string, Set<ValueKind>>();
    for (const row of rows) {
        for (const [key, value] of Object.entries(row)) {
            let set = kinds.get(key);
            if (!set) {
                set = new Set<ValueKind>();
                kinds.set(key, set);
            }
            if (value !== null && value !== undefined) set.add(kindOf(value));
        }
    }
    const keys = Array.from(kinds.keys());
    const asText = new Set(
        keys.filter(key => {
            const set = kinds.get(key) as Set<ValueKind>;
            return set.size > 1 || set.has('json');
        }),
    );
    return rows.map(row => {
        const out: Record<string, unknown> = {};
        for (const key of keys) {
            const value = row[key];
            if (value === null || value === undefined) out[key] = null;
            else if (asText.has(key)) out[key] = typeof value === 'string' ? value : JSON.stringify(value);
            else out[key] = value;
        }
        return out;
    });
}
