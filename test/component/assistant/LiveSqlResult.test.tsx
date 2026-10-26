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
            fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
            await waitFor(() => expect(screen.getByText('fresh')).toBeInTheDocument());
            expect(screen.queryByText('Expired')).not.toBeInTheDocument();
        });
    });

    it('shows the gate message instead of refreshing when the tool is turned off', async () => {
        jest.mocked(refreshHandle).mockResolvedValue({
            error: 'denied_by_policy',
            message: 'list_rules is turned off, so rules_1 cannot be refreshed',
        });
        const store = new DuckDbDataHandleStore(async () => new FakeDuckDbEngine());
        const toolPolicy = jest.fn(() => 'deny' as const);
        render(
            <DataHandleStoreProvider store={store} toolPolicy={toolPolicy}>
                <LiveSqlResult entry={entry} records={records} />
            </DataHandleStoreProvider>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('list_rules is turned off'));
        expect(refreshHandle).toHaveBeenCalledWith('rules_1', expect.objectContaining({ toolPolicy: expect.any(Function) }));
        expect(screen.getByText('old')).toBeInTheDocument();
    });
});
