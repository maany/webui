import { normalizeRows } from '@/lib/infrastructure/assistant/duckdb/row-normalizer';
import { arrowTableToRows, type ArrowLikeTable } from '@/lib/infrastructure/assistant/duckdb/arrow-rows';

describe('normalizeRows', () => {
    it('keeps consistent scalar columns as they are', () => {
        expect(
            normalizeRows([
                { id: 'a', n: 1, ok: true },
                { id: 'b', n: 2.5, ok: false },
            ]),
        ).toEqual([
            { id: 'a', n: 1, ok: true },
            { id: 'b', n: 2.5, ok: false },
        ]);
    });

    it('fills missing columns with null', () => {
        expect(normalizeRows([{ a: 1 }, { b: 'x' }])).toEqual([
            { a: 1, b: null },
            { a: null, b: 'x' },
        ]);
    });

    it('turns mixed scalar columns into text', () => {
        expect(normalizeRows([{ value: true }, { value: 'yes' }, { value: 3 }, { value: null }])).toEqual([
            { value: 'true' },
            { value: 'yes' },
            { value: '3' },
            { value: null },
        ]);
    });

    it('JSON encodes objects and arrays', () => {
        expect(normalizeRows([{ meta: { k: 1 }, list: [1, 2] }])).toEqual([{ meta: '{"k":1}', list: '[1,2]' }]);
    });

    it('returns an empty list for no rows', () => {
        expect(normalizeRows([])).toEqual([]);
    });
});

describe('arrowTableToRows', () => {
    const table = (fields: { name: string; type: string }[], rows: Record<string, unknown>[]): ArrowLikeTable => ({
        schema: { fields },
        toArray: () => rows.map(row => ({ toJSON: () => row })),
    });

    it('returns column names in schema order and plain values', () => {
        const result = arrowTableToRows(
            table(
                [
                    { name: 'state', type: 'Utf8' },
                    { name: 'n', type: 'Float64' },
                ],
                [{ n: 2, state: 'OK' }],
            ),
        );
        expect(result).toEqual({ columns: ['state', 'n'], rows: [{ state: 'OK', n: 2 }] });
    });

    it('formats date and timestamp columns as ISO strings', () => {
        const result = arrowTableToRows(
            table(
                [
                    { name: 'ts', type: 'Timestamp<MICROSECOND>' },
                    { name: 'd', type: 'Date32<DAY>' },
                ],
                [{ ts: Date.UTC(2026, 0, 1, 10), d: Date.UTC(2026, 0, 2) }],
            ),
        );
        expect(result.rows[0]).toEqual({ ts: '2026-01-01T10:00:00.000Z', d: '2026-01-02T00:00:00.000Z' });
    });

    it('converts bigints, typed arrays, vectors and struct rows', () => {
        const vector = { toArray: () => Int32Array.from([1, 2]) };
        const struct = { toJSON: () => ({ x: 1 }) };
        const result = arrowTableToRows(
            table(
                [
                    { name: 'big', type: 'Int64' },
                    { name: 'list', type: 'List<Int32>' },
                    { name: 'struct', type: 'Struct' },
                    { name: 'missing', type: 'Utf8' },
                ],
                [{ big: BigInt(5), list: vector, struct }],
            ),
        );
        expect(result.rows[0]).toEqual({ big: 5, list: [1, 2], struct: { x: 1 }, missing: null });
    });
});
