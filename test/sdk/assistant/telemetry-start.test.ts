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

    it('does not export a known secret that straddles the content cut', async () => {
        const secret = 'my-secret-token-value-123';
        const exporter = new InMemorySpanExporter();
        const telemetry = startAssistantTelemetry({
            contentLevel: () => 'full',
            identity: { userId: () => undefined },
            secrets: () => [secret],
            exporters: [exporter],
        });
        telemetry.handle({ ...(events[0] as Extract<AssistantEvent, { type: 'turn-started' }>), userText: `${'a'.repeat(7990)}${secret}tail` });
        telemetry.handle(events[3]);
        await telemetry.forceFlush();
        const everything = JSON.stringify(exporter.getFinishedSpans().map(s => [s.name, s.attributes]));
        expect(everything).not.toContain(secret.slice(0, 12));
        expect(everything).toContain('[REDACTED]');
        await telemetry.shutdown();
    });

    it('exports no content for a turn whose level dropped after the content was captured', async () => {
        const exporter = new InMemorySpanExporter();
        let level: 'full' | 'metadata' = 'full';
        const telemetry = startAssistantTelemetry({
            contentLevel: () => level,
            identity: { userId: () => undefined },
            secrets: () => [],
            exporters: [exporter],
        });
        telemetry.handle(events[0]);
        telemetry.handle(events[1]);
        level = 'metadata';
        telemetry.handle(events[2]);
        telemetry.handle(events[3]);
        await telemetry.forceFlush();
        const spans = exporter.getFinishedSpans();
        expect(spans.length).toBeGreaterThan(0);
        const keys = [
            'langfuse.trace.input',
            'langfuse.trace.output',
            'langfuse.observation.input',
            'langfuse.observation.output',
            'gen_ai.tool.call.arguments',
            'gen_ai.tool.call.result',
            'db.query.text',
        ];
        for (const span of spans) {
            keys.forEach(key => expect(span.attributes[key]).toBeUndefined());
        }
        expect(JSON.stringify(spans.map(s => s.attributes))).not.toContain('please');
        await telemetry.shutdown();
    });

    it('resolves shutdown even when secrets() throws or an exporter fails to shut down', async () => {
        let broken = false;
        const failing: SpanExporter = {
            export: (_spans, done) => done({ code: 0 }),
            shutdown: () => Promise.reject(new Error('exporter shutdown failed')),
            forceFlush: () => Promise.reject(new Error('flush failed')),
        };
        const telemetry = startAssistantTelemetry({
            contentLevel: () => 'full',
            identity: { userId: () => undefined },
            secrets: () => {
                if (broken) {
                    throw new Error('settings broke');
                }
                return [];
            },
            exporters: [failing],
        });
        telemetry.handle(events[0]);
        broken = true;
        await expect(telemetry.forceFlush()).resolves.toBeUndefined();
        await expect(telemetry.shutdown()).resolves.toBeUndefined();
    });
});
