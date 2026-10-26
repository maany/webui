import { csvCell, stringifyValue, downloadCsv, toCsv } from '@/lib/infrastructure/assistant/csv';

describe('csv', () => {
    it('quotes fields that need it and escapes quotes', () => {
        expect(csvCell('plain')).toBe('plain');
        expect(csvCell('a,b')).toBe('"a,b"');
        expect(csvCell('say "hi"')).toBe('"say ""hi"""');
        expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
        expect(csvCell(' padded')).toBe('" padded"');
    });

    it('renders numbers, booleans, null and objects', () => {
        expect(csvCell(-5)).toBe('-5');
        expect(csvCell(true)).toBe('true');
        expect(csvCell(null)).toBe('');
        expect(csvCell(undefined)).toBe('');
        expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
    });

    it('neutralises spreadsheet formulas in strings', () => {
        expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
        expect(csvCell('@cmd')).toBe("'@cmd");
        expect(csvCell('-2+3')).toBe("'-2+3");
        expect(csvCell('+1')).toBe("'+1");
        expect(csvCell('\tx')).toBe("'\tx");
    });

    it('builds a header and one line per row', () => {
        expect(toCsv(['state', 'n'], [{ state: 'OK', n: 2 }, { state: 'Stuck' }])).toBe('state,n\r\nOK,2\r\nStuck,\r\n');
    });

    it('downloads through a temporary object URL', () => {
        const createObjectURL = jest.fn(() => 'blob:result');
        const revokeObjectURL = jest.fn();
        Object.assign(URL, { createObjectURL, revokeObjectURL });
        const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
        downloadCsv('result.csv', 'a\r\n');
        expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
        expect(click).toHaveBeenCalledTimes(1);
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:result');
        expect(document.querySelector('a[download]')).toBeNull();
        click.mockRestore();
    });

    it('downloads with the given file name and content', async () => {
        let blob: Blob | undefined;
        Object.assign(URL, {
            createObjectURL: (b: Blob) => {
                blob = b;
                return 'blob:x';
            },
            revokeObjectURL: jest.fn(),
        });
        let name = '';
        const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            name = this.download;
        });
        downloadCsv('result.csv', 'a,b\r\n1,2\r\n');
        expect(name).toBe('result.csv');
        expect(blob?.type).toContain('text/csv');
        const content = await new Promise<string>(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.readAsText(blob as Blob);
        });
        expect(content).toBe('a,b\r\n1,2\r\n');
        click.mockRestore();
    });

    it('serialises bigint, dates and nested values safely', () => {
        expect(csvCell(5n)).toBe('5');
        expect(csvCell({ a: 1n })).toBe('"{""a"":""1""}"');
        expect(csvCell([1n])).toBe('"[""1""]"');
        expect(csvCell(new Date('2026-10-25T10:00:00.000Z'))).toBe('2026-10-25T10:00:00.000Z');
        expect(csvCell(new Date('nope'))).toBe('');
        expect(stringifyValue({ a: 1n })).toBe('{"a":"1"}');
        expect(stringifyValue(new Date('nope'))).toBe('');
    });

    it('neutralises formulas after leading whitespace', () => {
        expect(csvCell(' =1+1')).toBe("' =1+1");
        expect(csvCell('  @x')).toBe("'  @x");
    });

    it('quotes CR and CRLF inside values and handles no columns', () => {
        expect(csvCell('a\rb')).toBe('"a\rb"');
        expect(csvCell('a\r\nb')).toBe('"a\r\nb"');
        expect(toCsv([], [{ a: 1 }])).toBe('\r\n\r\n');
    });
});
