import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ResultTable } from '@/component-library/features/assistant/ResultTable';
import { downloadCsv } from '@/lib/infrastructure/assistant/csv';

const EM_DASH = String.fromCharCode(0x2014);

jest.mock('@/lib/infrastructure/assistant/csv', () => ({
    ...jest.requireActual('@/lib/infrastructure/assistant/csv'),
    downloadCsv: jest.fn(),
}));

const columns = ['state', 'n'];
const rows = [
    { state: 'OK', n: 2 },
    { state: 'Stuck', n: 1 },
];

describe('ResultTable', () => {
    beforeEach(() => jest.mocked(downloadCsv).mockClear());

    it('renders the columns, rows and a row count', () => {
        render(<ResultTable columns={columns} rows={rows} totalRows={1234} />);
        expect(screen.getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['state', 'n']);
        expect(screen.getByText('Stuck')).toBeInTheDocument();
        expect(screen.getByText('Showing 2 of 1,234 rows')).toBeInTheDocument();
        expect(screen.queryByText('Expired')).not.toBeInTheDocument();
    });

    it('limits visible rows', () => {
        render(<ResultTable columns={columns} rows={rows} totalRows={2} maxVisibleRows={1} />);
        expect(screen.queryByText('Stuck')).not.toBeInTheDocument();
        expect(screen.getByText('Showing 1 of 2 rows')).toBeInTheDocument();
    });

    it('exports the full result as CSV when a loader is given', async () => {
        const loadAllRows = jest.fn(async () => [...rows, { state: 'Replicating', n: 7 }]);
        render(<ResultTable columns={columns} rows={rows} totalRows={3} loadAllRows={loadAllRows} />);
        fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
        await waitFor(() => expect(downloadCsv).toHaveBeenCalledWith('rucio-bot-result.csv', 'state,n\r\nOK,2\r\nStuck,1\r\nReplicating,7\r\n'));
    });

    it('shows an expired badge with Refresh and exports the preview rows', async () => {
        const onRefresh = jest.fn();
        const loadAllRows = jest.fn();
        render(<ResultTable columns={columns} rows={rows} totalRows={2} expired onRefresh={onRefresh} loadAllRows={loadAllRows} />);
        expect(screen.getByText('Expired')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
        expect(onRefresh).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
        await waitFor(() => expect(downloadCsv).toHaveBeenCalledWith('rucio-bot-result.csv', 'state,n\r\nOK,2\r\nStuck,1\r\n'));
        expect(loadAllRows).not.toHaveBeenCalled();
    });

    it('shows an error and an empty state', () => {
        render(<ResultTable columns={['a']} rows={[]} totalRows={0} error="Refresh failed" />);
        expect(screen.getByRole('alert')).toHaveTextContent('Refresh failed');
        expect(screen.getByText('No rows')).toBeInTheDocument();
    });

    it('renders cell values as text and tolerates undefined rows', () => {
        const { container, rerender } = render(<ResultTable columns={['a']} rows={[{ a: '<b>bold</b>' }]} totalRows={1} />);
        expect(container.querySelector('b')).toBeNull();
        expect(screen.getByText('<b>bold</b>')).toBeInTheDocument();
        rerender(<ResultTable columns={['a']} rows={undefined as unknown as Record<string, unknown>[]} totalRows={0} />);
        expect(screen.getByText('No rows')).toBeInTheDocument();
    });

    it('survives bigint and dates in cells', () => {
        render(<ResultTable columns={['a', 'b', 'c']} rows={[{ a: { x: BigInt(1) }, b: [BigInt(2)], c: new Date('nope') }]} totalRows={1} />);
        expect(screen.getByText('{"x":"1"}')).toBeInTheDocument();
        expect(screen.getByText('["2"]')).toBeInTheDocument();
    });

    it('renders null rows as empty cells and truncates by code points', () => {
        const emoji = '\u{1F600}'.repeat(130);
        const { container } = render(<ResultTable columns={['a']} rows={[null as unknown as Record<string, unknown>, { a: emoji }]} totalRows={2} />);
        expect(screen.getByRole('table', { name: 'Query result' })).toBeInTheDocument();
        const cells = container.querySelectorAll('tbody td');
        expect(cells[0].textContent).toBe('');
        expect(Array.from(cells[1].textContent ?? '')).toHaveLength(121);
    });

    it('shows an inline error when the export fails', async () => {
        const loadAllRows = jest.fn(async () => {
            throw new Error('boom');
        });
        render(<ResultTable columns={columns} rows={rows} totalRows={3} loadAllRows={loadAllRows} />);
        fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
        expect(await screen.findByText('Could not export the rows.')).toBeInTheDocument();
        expect(downloadCsv).not.toHaveBeenCalled();
    });

    it('has no em dash in its copy', () => {
        const { container } = render(<ResultTable columns={columns} rows={rows} totalRows={2} expired onRefresh={jest.fn()} />);
        expect(container.textContent).not.toContain(EM_DASH);
    });

    it('says rows are not stored and hides export until refreshed', () => {
        const onRefresh = jest.fn();
        render(<ResultTable columns={columns} rows={[]} totalRows={1234} expired rowsOmitted onRefresh={onRefresh} />);
        expect(screen.getByText('Rows not stored (1,234 rows). Refresh to run the query again.')).toBeInTheDocument();
        expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
        expect(screen.getByText('Expired')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
        expect(onRefresh).toHaveBeenCalled();
    });
});
