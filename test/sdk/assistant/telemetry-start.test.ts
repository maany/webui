import { InMemorySpanExporter, type ReadableSpan, type SpanExporter } from '@opentelemetry/sdk-trace';
import { startAssistantTelemetry } from '@/lib/infrastructure/assistant/telemetry';
import type { AssistantEvent } from '@/lib/core/entity/assistant/events';

/** Keeps exported span names after shutdown (InMemorySpanExporter clears itself on shutdown). */
class RecordingExporter implements SpanExporter {
    names: string[] = [];
    export(spans: ReadableSpan[], done: Parameters<SpanExporter['export']>[1]): void {
        this.names.push(...spans.map(span => span.name));
        done({ code: 0 });
    }
    shutdown(): Promise<void> {
        return Promise.resolve();
    }
}

const usage = { inputTokens: 1, outputTokens: 1, costUSD: null, durationMs: 0 };

const events: AssistantEvent[] = [
    {
        type: 'turn-started',
        conversationId: 'conv-1',
        turnId: 'turn-1',
        providerKind: 'anthropic',
        model: 'claude',
        at: 1000,
        userText: 'use key sk-abcdefghijklmnopqrstuvwx please',
    },
    {
        type: 'tool-call-started',
        turnId: 'turn-1',
        toolCallId: 'call-1',
        toolName: 'get_rule',
        args: { note: 'my-local-key-123', header: 'Bearer abcdefgh12345' },
        policy: 'allow',
        at: 1100,
    },
    { type: 'tool-call-finished', turnId: 'turn-1', toolCallId: 'call-1', durationMs: 10, resultSummary: 'ok', at: 1110 },
    { type: 'turn-finished', turnId: 'turn-1', status: 'completed', usage, at: 1200 },
];

describe('startAssistantTelemetry', () => {
    it('scrubs every span before export, including runtime secrets', async () => {
        const exporter = new InMemorySpanExporter();
        const telemetry = startAssistantTelemetry({
            contentLevel: () => 'full',
            identity: { userId: () => 'root@def' },
            secrets: () => ['my-local-key-123'],
            exporters: [exporter],
        });
        events.forEach(event => telemetry.handle(event));
        await telemetry.forceFlush();

        const everything = JSON.stringify(exporter.getFinishedSpans().map(s => [s.name, s.attributes]));
        expect(everything).not.toContain('sk-abcdefghijklmnopqrstuvwx');
        expect(everything).not.toContain('my-local-key-123');
        expect(everything).not.toContain('abcdefgh12345');
        expect(everything).toContain('[REDACTED]');
        expect(exporter.getFinishedSpans()[0].resource.attributes['service.name']).toBe('rucio-webui');
        await telemetry.shutdown();
    });

    it('feeds every sink, ends open spans on shutdown and ignores later events', async () => {
        const first = new RecordingExporter();
        const second = new RecordingExporter();
        const telemetry = startAssistantTelemetry({
            contentLevel: () => 'metadata',
            identity: { userId: () => undefined },
            secrets: () => [],
            exporters: [first, second],
        });
        telemetry.handle(events[0]);
        await telemetry.shutdown();
        expect(first.names).toEqual(['invoke_agent Rucio bot']);
        expect(second.names).toEqual(['invoke_agent Rucio bot']);
        telemetry.handle(events[3]);
        expect(first.names).toHaveLength(1);
    });

    it('never throws into the caller', () => {
        const telemetry = startAssistantTelemetry({
            contentLevel: () => {
                throw new Error('settings broke');
            },
            identity: { userId: () => undefined },
            secrets: () => [],
            exporters: [new InMemorySpanExporter()],
        });
        expect(() => telemetry.handle(events[0])).not.toThrow();
    });
});
