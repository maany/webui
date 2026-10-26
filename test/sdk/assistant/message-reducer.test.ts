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
});

describe('helpers', () => {
    it('trims large results to a preview', () => {
        expect(trimToolResult({ a: 1 }, 100)).toEqual({ a: 1 });
        expect(trimToolResult({ big: 'x'.repeat(200) }, 50)).toEqual({ preview: expect.any(String), trimmed: true });
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

    it('appends approval parts', () => {
        const message = addApprovalPart(empty(), { toolCallId: 't1', decision: 'approved', scope: 'once', approver: 'root@def', at: 'now' });
        expect(message.parts).toEqual([{ type: 'approval', toolCallId: 't1', decision: 'approved', scope: 'once', approver: 'root@def', at: 'now' }]);
    });
});
