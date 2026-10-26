import { downloadText } from '@/lib/infrastructure/assistant/conversation-export';

const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV field. Strings that a spreadsheet would run as a formula get a leading quote. */
export function csvCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    let text = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 CSV with a header row and CRLF line endings. */
export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
    const lines = [columns.map(csvCell).join(',')];
    for (const row of rows) lines.push(columns.map(column => csvCell(row[column])).join(','));
    return `${lines.join('\r\n')}\r\n`;
}

export function downloadCsv(fileName: string, csv: string): void {
    downloadText(fileName, 'text/csv;charset=utf-8', csv);
}
