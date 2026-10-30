import { downloadText } from '@/lib/infrastructure/assistant/conversation-export';

const FORMULA_START = /^(?:[\t\r]|\s*[=+\-@])/;

/** Text for a cell value; never throws (bigint becomes a string, an invalid Date is empty). */
export function stringifyValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'bigint') return String(value);
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value, (_key, inner) => (typeof inner === 'bigint' ? String(inner) : inner)) ?? '';
        } catch {
            return '';
        }
    }
    return String(value);
}

/** One CSV field. Strings that a spreadsheet would run as a formula get a leading quote. */
export function csvCell(value: unknown): string {
    let text = stringifyValue(value);
    if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 CSV with a header row and CRLF line endings. */
export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
    const lines = [columns.map(csvCell).join(',')];
    for (const row of rows) lines.push(columns.map(column => csvCell(row?.[column])).join(','));
    return `${lines.join('\r\n')}\r\n`;
}

export function downloadCsv(fileName: string, csv: string): void {
    downloadText(fileName, 'text/csv;charset=utf-8', csv);
}
