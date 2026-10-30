import fetchMock from 'jest-fetch-mock';
import { QueryClient } from '@tanstack/react-query';
import type { ToolSpec } from '@/lib/core/entity/assistant/tool';
import { z } from 'zod';
import type { ToolPolicy } from '@/lib/core/entity/assistant/tool';
import { DuckDbDataHandleStore } from '@/lib/infrastructure/assistant/duckdb/duckdb-data-handle-store';
import { createFeatureTool } from '@/lib/infrastructure/assistant/feature-executor';
import type { HandleRecord } from '@/lib/infrastructure/assistant/message-selectors';
import { refreshHandle } from '@/lib/infrastructure/assistant/refresh-handle';
import { registerTools } from '@/lib/infrastructure/assistant/tool-registry';
import type { ToolExecutionContext } from '@/lib/infrastructure/assistant/tool-types';
import { findToolsTool, refreshHandleTool, runSqlTool } from '@/lib/infrastructure/assistant/tools/core-tools';
import { FakeDuckDbEngine, rowsOf } from 'test/fixtures/assistant/fake-duckdb-engine';
import { fakeResponse, ndjson } from 'test/fixtures/assistant/fake-response';

const spec = (
    name: string,
    domain: ToolSpec['domain'],
    description: string,
    extra: Partial<ToolSpec<Record<string, unknown>>> = {},
): ToolSpec<Record<string, unknown>> => ({
    name,
    domain,
    description,
    input: z.object({ state: z.string().optional() }),
    risk: 'read',
    requires: { flags: [] },
    executor: 'feature',
    output: 'rows',
    route: { path: `/api/feature/${name.replace(/_/g, '-')}`, method: 'GET' },
    describeCall: () => name,
    ...extra,
});

registerTools([
    createFeatureTool(spec('list_rules', 'rules', 'List replication rules with their state.')),
    createFeatureTool(spec('list_accounts', 'accounts', 'List accounts. Admins only.')),
    createFeatureTool(
        spec('add_account_attribute', 'accounts', 'Add an attribute.', {
            risk: 'write',
            route: { path: '/api/feature/add-account-attribute', method: 'POST' },
        }),
    ),
    findToolsTool,
    runSqlTool,
    refreshHandleTool,
]);

function setup(records: HandleRecord[] = []) {
    const engine = new FakeDuckDbEngine();
    const handles = new DuckDbDataHandleStore(async () => engine);
    const controller = new AbortController();
    const ctx: ToolExecutionContext = {
        signal: controller.signal,
        conversationId: 'c1',
        turnId: 't1',
        toolCallId: 'call-1',
        accountKey: 'root@def',
        handles,
        pages: { list: () => [] } as unknown as ToolExecutionContext['pages'],
        navigate: jest.fn(),
        queryClient: new QueryClient(),
        emit: jest.fn(),
        activateTools: jest.fn(),
        isToolVisible: name => name !== 'list_accounts',
        handleRecords: () => records,
    };
    return { engine, handles, ctx, controller };
}

beforeEach(() => fetchMock.resetMocks());

describe('find_tools', () => {
    it('loads visible matching tools into the active set', async () => {
        const { ctx } = setup();
        const result = (await findToolsTool.execute({ query: 'rules' }, ctx)) as { tools: { name: string }[]; note: string };
        expect(result.tools.map(tool => tool.name)).toEqual(['list_rules']);
        expect(result.note).toBe('These tools are loaded. Call them directly in your next step.');
        expect(ctx.activateTools).toHaveBeenCalledWith(['list_rules']);
    });

    it('never offers hidden tools', async () => {
        const { ctx } = setup();
        const result = (await findToolsTool.execute({ query: 'accounts' }, ctx)) as { tools: { name: string }[] };
        expect(result.tools.map(tool => tool.name)).toEqual(['add_account_attribute']);
    });

    it('fails closed when visibility is unknown', async () => {
        const { ctx } = setup();
        const blind: ToolExecutionContext = { ...ctx, isToolVisible: undefined };
        const result = (await findToolsTool.execute({ query: 'rules' }, blind)) as { tools: unknown[] };
        expect(result.tools).toEqual([]);
        expect(ctx.activateTools).not.toHaveBeenCalled();
    });

    it('activates nothing when nothing matches', async () => {
        const { ctx } = setup();
        const result = (await findToolsTool.execute({ query: 'zzz' }, ctx)) as { tools: unknown[] };
        expect(result.tools).toEqual([]);
        expect(ctx.activateTools).not.toHaveBeenCalled();
    });
});

describe('run_sql', () => {
    it('returns the query result and emits sql-executed with the tool call id', async () => {
        const { ctx, handles } = setup();
        await handles.ingestRows('rules', { toolName: 'list_rules', args: {}, fetchedAt: 'x' }, rowsOf([{ i: 1 }, { i: 2 }]), { rowCap: 10 });
        const result = await runSqlTool.execute({ sql: 'SELECT * FROM rules_1' }, ctx);
        expect(result).toEqual({ columns: ['i'], rows: [{ i: 1 }, { i: 2 }], totalRows: 2 });
        expect(ctx.emit).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'sql-executed', toolCallId: 'call-1', turnId: 't1', sql: 'SELECT * FROM rules_1', totalRows: 2 }),
        );
    });

    it('rejects write statements as invalid_args', async () => {
        const { ctx } = setup();
        await expect(runSqlTool.execute({ sql: 'DROP TABLE rules_1' }, ctx)).resolves.toMatchObject({
            error: 'invalid_args',
            message: 'Only SELECT or WITH queries are allowed',
        });
    });

    it('tells the model to refresh an expired handle', async () => {
        const { ctx } = setup([{ name: 'rules_1', toolName: 'list_rules', args: {}, fetchedAt: 'x' }]);
        await expect(runSqlTool.execute({ sql: 'SELECT * FROM rules_1' }, ctx)).resolves.toEqual({
            error: 'not_found',
            message: 'Handle rules_1 has expired. Call refresh_handle with handle "rules_1", then run the query again.',
        });
    });

    it('lists live handles when the name is unknown', async () => {
        const { ctx } = setup();
        await expect(runSqlTool.execute({ sql: 'SELECT * FROM nope_1' }, ctx)).resolves.toEqual({
            error: 'not_found',
            message: 'There is no handle named nope_1. Live handles: none.',
        });
    });

    it('caps wide results by size and reports rowsShown', async () => {
        const { ctx, handles } = setup();
        const wide = Array.from({ length: 150 }, (_, i) => ({ i, text: 'x'.repeat(500) }));
        await handles.ingestRows('wide', { toolName: 'list_rules', args: {}, fetchedAt: 'x' }, rowsOf(wide), { rowCap: 1000 });
        const result = (await runSqlTool.execute({ sql: 'SELECT * FROM wide_1', save_as: 'kept' }, ctx)) as {
            rows: unknown[];
            rowsShown?: number;
            totalRows: number;
            columns: string[];
            savedAs?: string;
        };
        expect(JSON.stringify(result).length).toBeLessThanOrEqual(16000);
        expect(result.rowsShown).toBe(result.rows.length);
        expect(result.rows.length).toBeLessThan(150);
        expect(result.rows.length).toBeGreaterThan(0);
        expect(result).toMatchObject({ totalRows: 150, columns: ['i', 'text'], savedAs: 'kept' });
    });

    it('omits rowsShown when every row fits', async () => {
        const { ctx, handles } = setup();
        await handles.ingestRows('rules', { toolName: 'list_rules', args: {}, fetchedAt: 'x' }, rowsOf([{ i: 1 }]), { rowCap: 10 });
        const result = await runSqlTool.execute({ sql: 'SELECT * FROM rules_1' }, ctx);
        expect(result).not.toHaveProperty('rowsShown');
    });

    it('never puts rows into the sql-executed event', async () => {
        const { ctx, handles } = setup();
        await handles.ingestRows('rules', { toolName: 'list_rules', args: {}, fetchedAt: 'x' }, rowsOf([{ secret: 'abc' }]), { rowCap: 10 });
        await runSqlTool.execute({ sql: 'SELECT * FROM rules_1' }, ctx);
        const event = (ctx.emit as jest.Mock).mock.calls[0][0];
        expect(JSON.stringify(event)).not.toContain('abc');
        expect(event).not.toHaveProperty('rows');
    });

    it('describes the call on one line', () => {
        expect(runSqlTool.spec.describeCall({ sql: 'SELECT\n  state\nFROM rules_1', save_as: 'x' })).toBe(
            'Run SQL and save as x: SELECT state FROM rules_1',
        );
    });
});

describe('refresh_handle', () => {
    it('re-runs the original read with the stored args and keeps the handle name', async () => {
        const { ctx, handles } = setup([{ name: 'rules_1', toolName: 'list_rules', args: { state: 'Stuck' }, fetchedAt: 'x' }]);
        fetchMock.mockImplementationOnce(async () => fakeResponse({ chunks: [ndjson({ id: 'a' }, { id: 'b' })] }));
        const result = await refreshHandleTool.execute({ handle: 'rules_1' }, ctx);
        expect(fetchMock.mock.calls[0][0]).toBe('/api/feature/list-rules?state=Stuck');
        expect(result).toMatchObject({ handle: 'rules_1', rowCount: 2 });
        expect(handles.listHandles().map(handle => handle.name)).toEqual(['rules_1']);
    });

    it('sends the context account with the re-run read', async () => {
        const { ctx } = setup([{ name: 'rules_1', toolName: 'list_rules', args: {}, fetchedAt: 'x' }]);
        fetchMock.mockImplementationOnce(async () => fakeResponse({ chunks: [ndjson({ id: 'a' })] }));
        await refreshHandleTool.execute({ handle: 'rules_1' }, { ...ctx, accountKey: 'jdoe@def' });
        expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'x-rucio-assistant-account': 'jdoe@def' });
    });

    it('refreshes the sources of a saved query first', async () => {
        const records: HandleRecord[] = [
            { name: 'rules_1', toolName: 'list_rules', args: {}, fetchedAt: 'x' },
            { name: 'stuck', toolName: 'run_sql', args: { sql: 'SELECT * FROM rules_1', save_as: 'stuck' }, fetchedAt: 'x' },
        ];
        const { handles } = setup(records);
        fetchMock.mockImplementationOnce(async () => fakeResponse({ chunks: [ndjson({ id: 'a' })] }));
        const result = await refreshHandle('stuck', { records, handles, signal: new AbortController().signal });
        expect(result).toMatchObject({ savedAs: 'stuck', totalRows: 1 });
        expect(
            handles
                .listHandles()
                .map(handle => handle.name)
                .sort(),
        ).toEqual(['rules_1', 'stuck']);
    });

    it('reports unknown handles and refuses non-read tools', async () => {
        const { handles } = setup();
        const signal = new AbortController().signal;
        await expect(refreshHandle('nope', { records: [], handles, signal })).resolves.toMatchObject({ error: 'not_found' });
        await expect(
            refreshHandle('attrs_1', {
                records: [{ name: 'attrs_1', toolName: 'add_account_attribute', args: {}, fetchedAt: 'x' }],
                handles,
                signal,
            }),
        ).resolves.toMatchObject({ error: 'forbidden' });
    });

    describe('gate', () => {
        const rulesRecord: HandleRecord = { name: 'rules_1', toolName: 'list_rules', args: {}, fetchedAt: 'x' };
        const withPolicy = (policy: ToolPolicy, visible = true) => {
            const { ctx, handles } = setup([rulesRecord]);
            return { ctx: { ...ctx, isToolVisible: () => visible, toolPolicy: () => policy }, handles };
        };

        it('refuses a source tool that is not visible', async () => {
            const { ctx } = withPolicy('allow', false);
            await expect(refreshHandleTool.execute({ handle: 'rules_1' }, ctx)).resolves.toMatchObject({ error: 'forbidden' });
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('refuses a source tool whose live policy is deny', async () => {
            const { ctx } = withPolicy('deny');
            await expect(refreshHandleTool.execute({ handle: 'rules_1' }, ctx)).resolves.toMatchObject({ error: 'denied_by_policy' });
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('tells the model to call the tool itself when the policy is ask', async () => {
            const { ctx } = withPolicy('ask');
            const result = await refreshHandleTool.execute({ handle: 'rules_1' }, ctx);
            expect(result).toMatchObject({ error: 'denied_by_policy', message: expect.stringContaining('list_rules') });
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('checks the sources of a saved query', async () => {
            const stuck: HandleRecord = { name: 'stuck', toolName: 'run_sql', args: { sql: 'SELECT * FROM rules_1' }, fetchedAt: 'x' };
            const { ctx } = setup([rulesRecord, stuck]);
            const denying: ToolExecutionContext = { ...ctx, toolPolicy: name => (name === 'list_rules' ? 'deny' : 'allow') };
            await expect(refreshHandleTool.execute({ handle: 'stuck' }, denying)).resolves.toMatchObject({ error: 'denied_by_policy' });
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('allows a read tool when no policy lookup is supplied', async () => {
            const { ctx } = setup([rulesRecord]);
            fetchMock.mockImplementationOnce(async () => fakeResponse({ chunks: [ndjson({ id: 'a' })] }));
            await expect(refreshHandleTool.execute({ handle: 'rules_1' }, ctx)).resolves.toMatchObject({ handle: 'rules_1', rowCount: 1 });
        });
    });
});
