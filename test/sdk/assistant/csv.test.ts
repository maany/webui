import { csvCell, downloadCsv, toCsv } from '@/lib/infrastructure/assistant/csv';

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
});
