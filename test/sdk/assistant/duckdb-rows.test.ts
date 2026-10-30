import { normalizeRows } from '@/lib/infrastructure/assistant/duckdb/row-normalizer';
import { abortError, isAbortError, errorMessage } from '@/lib/infrastructure/assistant/abort';
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

    it('keeps safe bigints as numbers and turns unsafe ones into text', () => {
        expect(normalizeRows([{ a: BigInt(5), b: BigInt('9007199254740993') }])).toEqual([{ a: 5, b: '9007199254740993' }]);
    });

    it('does not throw on bigints inside objects', () => {
        expect(normalizeRows([{ o: { n: BigInt(2) } }])).toEqual([{ o: '{"n":"2"}' }]);
    });

    it('turns dates into ISO text and invalid dates into null', () => {
        expect(normalizeRows([{ d: new Date(Date.UTC(2026, 0, 1)) }, { d: new Date(NaN) }])).toEqual([
            { d: '2026-01-01T00:00:00.000Z' },
            { d: null },
        ]);
    });

    it('turns functions, symbols, NaN and Infinity into null', () => {
        expect(normalizeRows([{ f: () => 1, s: Symbol('x'), n: NaN, i: Infinity, ok: 1 }])).toEqual([{ f: null, s: null, n: null, i: null, ok: 1 }]);
    });

    it('keeps __proto__ and constructor columns as own keys', () => {
        const row = JSON.parse('{"__proto__":1,"constructor":2}');
        const out = normalizeRows([row, { other: 1 }]);
        expect(Object.keys(out[0])).toEqual(['__proto__', 'constructor', 'other']);
        expect(Object.getOwnPropertyDescriptor(out[0], '__proto__')?.value).toBe(1);
        expect(Object.getOwnPropertyDescriptor(out[1], '__proto__')?.value).toBeNull();
        expect(JSON.stringify(out[0])).toBe('{"__proto__":1,"constructor":2,"other":null}');
    });
});

describe('abort helpers', () => {
    it('recognises abort errors', () => {
        expect(isAbortError(new DOMException('x', 'AbortError'))).toBe(true);
        const named = new Error('x');
        named.name = 'AbortError';
        expect(isAbortError(named)).toBe(true);
        expect(isAbortError(abortError())).toBe(true);
    });

    it('rejects other values', () => {
        expect(isAbortError(new Error('x'))).toBe(false);
        expect(isAbortError(null)).toBe(false);
        expect(isAbortError('AbortError')).toBe(false);
        expect(isAbortError(undefined)).toBe(false);
    });

    it('extracts messages', () => {
        expect(errorMessage(new Error('boom'))).toBe('boom');
        expect(errorMessage('text')).toBe('text');
        expect(errorMessage(42)).toBe('42');
        expect(errorMessage({ message: 'obj' })).toBe('obj');
        expect(errorMessage(null)).toBe('null');
    });

    it('caps messages at 1000 characters', () => {
        expect(errorMessage(new Error('a'.repeat(5000)))).toHaveLength(1000);
        expect(errorMessage('b'.repeat(5000))).toHaveLength(1000);
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

    it('keeps __proto__ columns as own keys', () => {
        const row = JSON.parse('{"__proto__":1}');
        const result = arrowTableToRows(
            table(
                [
                    { name: '__proto__', type: 'Int32' },
                    { name: 'other', type: 'Int32' },
                ],
                [row],
            ),
        );
        expect(Object.getOwnPropertyDescriptor(result.rows[0], '__proto__')?.value).toBe(1);
        expect(Object.getOwnPropertyDescriptor(result.rows[0], 'other')?.value).toBeNull();
    });

    it('turns unsafe Int64 values into strings', () => {
        const result = arrowTableToRows(table([{ name: 'big', type: 'Int64' }], [{ big: BigInt('9007199254740993') }]));
        expect(result.rows[0]).toEqual({ big: '9007199254740993' });
    });

    it('converts bigint and invalid temporal values', () => {
        const result = arrowTableToRows(table([{ name: 'ts', type: 'Timestamp<MILLISECOND>' }], [{ ts: BigInt(Date.UTC(2026, 0, 1)) }, { ts: NaN }]));
        expect(result.rows).toEqual([{ ts: '2026-01-01T00:00:00.000Z' }, { ts: null }]);
    });
});
