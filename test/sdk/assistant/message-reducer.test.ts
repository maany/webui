import type { ChatMessage } from '@/lib/core/entity/assistant/conversation';
import {
    addApprovalPart,
    applyRunnerUpdate,
    closeReasoning,
    expireStaleParts,
    monotonicIso,
    STEP_LIMIT_NOTICE,
    trimToolResult,
} from '@/lib/infrastructure/assistant/message-reducer';

const empty = (): ChatMessage => ({ id: 'a1', conversationId: 'c1', role: 'assistant', parts: [], createdAt: '2026-10-25T10:00:00.000Z' });

describe('applyRunnerUpdate', () => {
    it('merges consecutive text and reasoning deltas into single parts', () => {
        let message = empty();
        message = applyRunnerUpdate(message, { type: 'reasoning-delta', text: 'Thinking ' });
        message = applyRunnerUpdate(message, { type: 'reasoning-delta', text: 'hard.' });
        message = applyRunnerUpdate(message, { type: 'text-delta', text: 'Hello ' });
        message = applyRunnerUpdate(message, { type: 'text-delta', text: 'world' });
        expect(message.parts).toEqual([
            { type: 'reasoning', text: 'Thinking hard.' },
            { type: 'text', text: 'Hello world' },
        ]);
    });

    it('tracks a tool call through approval to its result', () => {
        let message = applyRunnerUpdate(empty(), { type: 'tool-call', toolCallId: 't1', toolName: 'do_write', args: { id: 1 }, policy: 'ask' });
        expect(message.parts[0]).toMatchObject({ status: 'running' });
        message = applyRunnerUpdate(message, { type: 'approval-required', toolCallId: 't1' });
        expect(message.parts[0]).toMatchObject({ status: 'awaiting-approval' });
        message = applyRunnerUpdate(message, { type: 'tool-result', toolCallId: 't1', result: { ok: true }, durationMs: 12 });
        expect(message.parts[0]).toMatchObject({ status: 'done', result: { ok: true }, durationMs: 12 });
    });

    it('marks denied and failed tool calls', () => {
        let message = applyRunnerUpdate(empty(), { type: 'tool-call', toolCallId: 't1', toolName: 'x', args: {}, policy: 'deny' });
        message = applyRunnerUpdate(message, {
            type: 'tool-result',
            toolCallId: 't1',
            result: null,
            error: { error: 'denied_by_policy', message: 'no' },
            durationMs: 0,
        });
        expect(message.parts[0]).toMatchObject({ status: 'denied', error: { error: 'denied_by_policy' } });
        message = applyRunnerUpdate(message, { type: 'tool-call', toolCallId: 't2', toolName: 'y', args: {}, policy: 'allow' });
        message = applyRunnerUpdate(message, {
            type: 'tool-result',
            toolCallId: 't2',
            result: null,
            error: { error: 'timeout', message: 'slow' },
            durationMs: 60000,
        });
        expect(message.parts[1]).toMatchObject({ status: 'error' });
    });

    it('closes running calls when stopped and adds end-of-turn notices', () => {
        let message = applyRunnerUpdate(empty(), { type: 'tool-call', toolCallId: 't1', toolName: 'x', args: {}, policy: 'allow' });
        message = applyRunnerUpdate(message, { type: 'finished', status: 'stopped' });
        expect(message.parts[0]).toMatchObject({ status: 'error', error: { error: 'aborted' } });
        expect(message.parts[1]).toEqual({ type: 'notice', level: 'info', text: 'Stopped.' });
        expect(applyRunnerUpdate(empty(), { type: 'finished', status: 'step-limit' }).parts).toEqual([
            { type: 'notice', level: 'warning', text: STEP_LIMIT_NOTICE },
        ]);
        expect(applyRunnerUpdate(empty(), { type: 'finished', status: 'error', error: 'bad key' }).parts).toEqual([
            { type: 'notice', level: 'error', text: 'bad key' },
        ]);
    });
    it('upserts a repeated tool-call update instead of duplicating the part', () => {
        let message = applyRunnerUpdate(empty(), { type: 'tool-call', toolCallId: 't1', toolName: 'x', args: {}, policy: 'ask' });
        message = applyRunnerUpdate(message, { type: 'tool-call', toolCallId: 't1', toolName: 'x', args: { id: 2 }, policy: 'ask' });
        expect(message.parts).toHaveLength(1);
        expect(message.parts[0]).toMatchObject({ toolCallId: 't1', args: { id: 2 } });
    });

    it('does not move a finished tool call back to awaiting-approval', () => {
        let message = applyRunnerUpdate(empty(), { type: 'tool-call', toolCallId: 't1', toolName: 'x', args: {}, policy: 'allow' });
        message = applyRunnerUpdate(message, { type: 'tool-result', toolCallId: 't1', result: 1, durationMs: 1 });
        message = applyRunnerUpdate(message, { type: 'approval-required', toolCallId: 't1' });
        expect(message.parts[0]).toMatchObject({ status: 'done' });
    });
});

describe('helpers', () => {
    it('trims large results to a preview', () => {
        expect(trimToolResult({ a: 1 }, 100)).toEqual({ a: 1 });
        expect(trimToolResult({ big: 'x'.repeat(200) }, 50)).toEqual({ preview: expect.any(String), trimmed: true });
    });

    it('trims a rows-like result that has no sample array', () => {
        let message = applyRunnerUpdate(empty(), { type: 'tool-call', toolCallId: 't1', toolName: 'x', args: {}, policy: 'allow' });
        message = applyRunnerUpdate(message, {
            type: 'tool-result',
            toolCallId: 't1',
            result: { handle: 'h_1', rowCount: 1, columns: ['a'], big: 'x'.repeat(30_000) },
            durationMs: 1,
        });
        expect(message.parts[0]).toMatchObject({ result: { trimmed: true } });
    });

    it('trims an exempted sql result above the 64 KB ceiling', () => {
        let message = applyRunnerUpdate(empty(), { type: 'tool-call', toolCallId: 't1', toolName: 'run_sql', args: {}, policy: 'allow' });
        message = applyRunnerUpdate(message, {
            type: 'tool-result',
            toolCallId: 't1',
            result: { columns: ['a'], rows: [{ a: 'x'.repeat(100_000) }], totalRows: 1 },
            durationMs: 1,
        });
        expect(message.parts[0]).toMatchObject({ result: { trimmed: true } });
    });

    it('keeps a bounded sql result between 20 KB and 64 KB', () => {
        const result = { columns: ['a'], rows: [{ a: 'x'.repeat(30_000) }], totalRows: 1 };
        let message = applyRunnerUpdate(empty(), { type: 'tool-call', toolCallId: 't1', toolName: 'run_sql', args: {}, policy: 'allow' });
        message = applyRunnerUpdate(message, { type: 'tool-result', toolCallId: 't1', result, durationMs: 1 });
        expect(message.parts[0]).toMatchObject({ result });
    });

    it('sets the reasoning duration once', () => {
        const message = closeReasoning({ ...empty(), parts: [{ type: 'reasoning', text: 'r' }] }, 4000);
        expect(message.parts[0]).toEqual({ type: 'reasoning', text: 'r', durationMs: 4000 });
        expect(closeReasoning(message, 9)).toBe(message);
    });

    it('returns strictly increasing timestamps', () => {
        const a = monotonicIso(1000);
        const b = monotonicIso(1000);
        expect(b > a).toBe(true);
    });

    it('expires waiting approvals and aborts running calls of a reopened conversation', () => {
        const stored: ChatMessage = {
            ...empty(),
            parts: [
                { type: 'tool-call', toolCallId: 't1', toolName: 'w', args: {}, policy: 'ask', status: 'awaiting-approval' },
                { type: 'tool-call', toolCallId: 't2', toolName: 'r', args: {}, policy: 'allow', status: 'running' },
            ],
        };
        const [repaired] = expireStaleParts([stored], 'root@def', '2026-10-25T11:00:00.000Z');
        expect(repaired.parts).toEqual([
            expect.objectContaining({ toolCallId: 't1', status: 'expired' }),
            expect.objectContaining({ toolCallId: 't2', status: 'error', error: expect.objectContaining({ error: 'aborted' }) }),
            { type: 'approval', toolCallId: 't1', decision: 'expired', scope: 'once', approver: 'root@def', at: '2026-10-25T11:00:00.000Z' },
        ]);
        const untouched = { ...empty(), parts: [{ type: 'text' as const, text: 'hi' }] };
        expect(expireStaleParts([untouched], 'root@def', 'x')[0]).toBe(untouched);
    });

    it('reports an approved call that was still running as outcome unknown, never as runnable', () => {
        const stored: ChatMessage = {
            ...empty(),
            parts: [
                { type: 'tool-call', toolCallId: 't1', toolName: 'do_write', args: {}, policy: 'ask', status: 'running' },
                { type: 'approval', toolCallId: 't1', decision: 'approved', scope: 'once', approver: 'root@def', at: '2026-10-25T10:30:00.000Z' },
                { type: 'tool-call', toolCallId: 't2', toolName: 'do_write', args: {}, policy: 'ask', status: 'running' },
            ],
        };
        const [repaired] = expireStaleParts([stored], 'root@def', '2026-10-25T11:00:00.000Z');
        expect(repaired.parts[0]).toMatchObject({
            toolCallId: 't1',
            status: 'error',
            error: {
                error: 'aborted',
                message:
                    'Approved, but the page closed before the result arrived. The change may have been applied, so check its state before retrying.',
            },
        });
        // A running call without an approval keeps the plain aborted wording.
        expect(repaired.parts[2]).toMatchObject({
            toolCallId: 't2',
            status: 'error',
            error: { error: 'aborted', message: expect.stringContaining('stopped') },
        });
        expect(repaired.parts.filter(part => part.type === 'approval')).toHaveLength(1);
    });

    it('never adds a second approval part to a call that already has one', () => {
        const stored: ChatMessage = {
            ...empty(),
            parts: [
                { type: 'tool-call', toolCallId: 't1', toolName: 'do_write', args: {}, policy: 'ask', status: 'awaiting-approval' },
                { type: 'approval', toolCallId: 't1', decision: 'approved', scope: 'once', approver: 'root@def', at: '2026-10-25T10:30:00.000Z' },
            ],
        };
        const [repaired] = expireStaleParts([stored], 'root@def', '2026-10-25T11:00:00.000Z');
        expect(repaired.parts[0]).toMatchObject({ status: 'expired' });
        expect(repaired.parts.filter(part => part.type === 'approval')).toEqual([expect.objectContaining({ decision: 'approved' })]);
    });

    it('appends approval parts', () => {
        const message = addApprovalPart(empty(), { toolCallId: 't1', decision: 'approved', scope: 'once', approver: 'root@def', at: 'now' });
        expect(message.parts).toEqual([{ type: 'approval', toolCallId: 't1', decision: 'approved', scope: 'once', approver: 'root@def', at: 'now' }]);
    });
});
