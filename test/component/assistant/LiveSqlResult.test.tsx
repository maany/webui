import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DataHandleStoreProvider } from '@/component-library/features/assistant/DataHandleStoreContext';
import { LiveSqlResult } from '@/component-library/features/assistant/LiveSqlResult';
import { DuckDbDataHandleStore } from '@/lib/infrastructure/assistant/duckdb/duckdb-data-handle-store';
import { downloadCsv } from '@/lib/infrastructure/assistant/csv';
import { refreshHandle } from '@/lib/infrastructure/assistant/refresh-handle';
import { FakeDuckDbEngine, rowsOf } from 'test/fixtures/assistant/fake-duckdb-engine';

jest.mock('@/lib/infrastructure/assistant/csv', () => ({ ...jest.requireActual('@/lib/infrastructure/assistant/csv'), downloadCsv: jest.fn() }));
jest.mock('@/lib/infrastructure/assistant/refresh-handle', () => ({ refreshHandle: jest.fn() }));

const records = [{ name: 'rules_1', toolName: 'list_rules', args: {}, fetchedAt: '2026-10-25T10:00:00.000Z' }];
const entry = { toolCallId: 'c1', sql: 'SELECT * FROM rules_1', result: { columns: ['id'], rows: [{ id: 'old' }], totalRows: 1 } };

function setup() {
    const engine = new FakeDuckDbEngine();
    const store = new DuckDbDataHandleStore(async () => engine);
    const view = render(
        <DataHandleStoreProvider store={store}>
            <LiveSqlResult entry={entry} records={records} />
        </DataHandleStoreProvider>,
    );
    return { store, view };
}

describe('LiveSqlResult', () => {
    it('marks the result expired when its handle is gone and refreshes it', async () => {
        const { store } = setup();
        jest.mocked(refreshHandle).mockImplementation(async (name, deps) => {
            await deps.handles.ingestRows('rules', { toolName: 'list_rules', args: {}, fetchedAt: 'x' }, rowsOf([{ id: 'new' }]), {
                rowCap: 10,
                name,
            });
            return { handle: name, rowCount: 1, truncated: false, columns: ['id'], sample: [] };
        });
        expect(screen.getByText('Expired')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
        await waitFor(() => expect(screen.getByText('new')).toBeInTheDocument());
        expect(screen.queryByText('Expired')).not.toBeInTheDocument();
        expect(refreshHandle).toHaveBeenCalledWith('rules_1', expect.objectContaining({ records, handles: store }));
    });

    it('exports the full result from the live store', async () => {
        const { store } = setup();
        await act(async () => {
            await store.ingestRows('rules', { toolName: 'list_rules', args: {}, fetchedAt: 'x' }, rowsOf([{ id: 'a' }, { id: 'b' }]), { rowCap: 10 });
        });
        expect(screen.queryByText('Expired')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
        await waitFor(() => expect(downloadCsv).toHaveBeenCalledWith('rucio-bot-result.csv', 'id\r\na\r\nb\r\n'));
    });

    describe('a stored result without rows', () => {
        const stored = { toolCallId: 'c2', sql: 'SELECT * FROM rules_1', result: { columns: ['id'], totalRows: 3, rowsOmitted: true as const } };

        it('shows "Rows not stored" without a store', () => {
            render(<LiveSqlResult entry={stored} records={records} />);
            expect(screen.getByText(/Rows not stored/)).toBeInTheDocument();
            expect(screen.queryByTestId('assistant-result-table')).not.toBeInTheDocument();
        });

        it('is expired with a store and Refresh re-runs the query', async () => {
            const store = new DuckDbDataHandleStore(async () => new FakeDuckDbEngine());
            await store.ingestRows('rules', { toolName: 'list_rules', args: {}, fetchedAt: 'x' }, rowsOf([{ id: 'fresh' }]), { rowCap: 10 });
            render(
                <DataHandleStoreProvider store={store}>
                    <LiveSqlResult entry={{ ...stored, sql: 'SELECT * FROM rules_1' }} records={records} />
                </DataHandleStoreProvider>,
            );
            expect(screen.getByText('Expired')).toBeInTheDocument();
            expect(screen.getByText('Rows not stored (3 rows). Refresh to run the query again.')).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
            await waitFor(() => expect(screen.getByText('fresh')).toBeInTheDocument());
            expect(screen.queryByText('Expired')).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
        });
    });

    describe('refresh gate copy', () => {
        const renderGated = (gate: { toolPolicy?: () => 'ask' | 'deny' | 'allow'; isToolVisible?: () => boolean }) => {
            const store = new DuckDbDataHandleStore(async () => new FakeDuckDbEngine());
            render(
                <DataHandleStoreProvider store={store} {...gate}>
                    <LiveSqlResult entry={entry} records={records} />
                </DataHandleStoreProvider>,
            );
            fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
        };

        beforeEach(() => jest.mocked(refreshHandle).mockClear());

        it('explains an ask policy', async () => {
            renderGated({ toolPolicy: () => 'ask' });
            await waitFor(() =>
                expect(screen.getByRole('alert')).toHaveTextContent(
                    'Refreshing rules_1 needs your approval for list_rules. Ask Rucio bot to refresh it.',
                ),
            );
            expect(refreshHandle).not.toHaveBeenCalled();
            expect(screen.getByText('old')).toBeInTheDocument();
        });

        it('explains a deny policy', async () => {
            renderGated({ toolPolicy: () => 'deny' });
            await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('list_rules is turned off in your settings.'));
            expect(refreshHandle).not.toHaveBeenCalled();
        });

        it('explains a tool that is not visible', async () => {
            renderGated({ isToolVisible: () => false });
            await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('list_rules is not available to you.'));
            expect(refreshHandle).not.toHaveBeenCalled();
        });
    });

    it('re-syncs when the entry result changes', () => {
        const { rerender } = render(<LiveSqlResult entry={entry} records={records} />);
        expect(screen.getByText('old')).toBeInTheDocument();
        rerender(<LiveSqlResult entry={{ ...entry, result: { columns: ['id'], rows: [{ id: 'newer' }], totalRows: 1 } }} records={records} />);
        expect(screen.getByText('newer')).toBeInTheDocument();
    });

    it('aborts an in-flight refresh on unmount', async () => {
        let signal: AbortSignal | undefined;
        jest.mocked(refreshHandle).mockImplementation(async (_name, deps) => {
            signal = deps.signal;
            return new Promise(() => undefined);
        });
        const store = new DuckDbDataHandleStore(async () => new FakeDuckDbEngine());
        const { unmount } = render(
            <DataHandleStoreProvider store={store}>
                <LiveSqlResult entry={entry} records={records} />
            </DataHandleStoreProvider>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
        await waitFor(() => expect(signal).toBeDefined());
        unmount();
        expect(signal?.aborted).toBe(true);
    });
});
