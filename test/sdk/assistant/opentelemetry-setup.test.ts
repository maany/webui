import { trace, ROOT_CONTEXT } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

describe('OpenTelemetry packages under Jest', () => {
    it('records parent and child spans with explicit contexts and epoch millisecond times', () => {
        const exporter = new InMemorySpanExporter();
        const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] });
        const tracer = provider.getTracer('setup');
        // Epoch milliseconds as real events carry them (numbers below performance.now() would be read as
        // performance-relative times by the SDK).
        const parent = tracer.startSpan('parent', { startTime: 1_700_000_001_000 }, ROOT_CONTEXT);
        tracer.startSpan('child', { startTime: 1_700_000_001_100 }, trace.setSpan(ROOT_CONTEXT, parent)).end(1_700_000_001_200);
        parent.end(1_700_000_001_300);
        const [child, root] = exporter.getFinishedSpans();
        expect(child.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
        expect(child.startTime).toEqual([1_700_000_001, 100000000]);
    });

    it('resolves the browser OTLP exporter, which posts JSON with fetch in cors mode', async () => {
        const calls: [string, RequestInit][] = [];
        const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
            calls.push([String(url), init ?? {}]);
            return { status: 401, ok: false, headers: new Headers(), body: null } as unknown as Response;
        });
        const exporter = new OTLPTraceExporter({
            url: 'https://cloud.langfuse.com/api/public/otel/v1/traces',
            headers: { Authorization: 'Basic abc' },
        });
        const memory = new InMemorySpanExporter();
        const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter: memory })] });
        provider.getTracer('setup').startSpan('one').end();
        const result = await new Promise<{ code: number; error?: Error }>(resolve => exporter.export(memory.getFinishedSpans(), resolve));
        expect(result.code).toBe(1);
        expect(String(result.error)).toContain('401');
        expect(calls[0][0]).toBe('https://cloud.langfuse.com/api/public/otel/v1/traces');
        expect(calls[0][1]).toMatchObject({
            method: 'POST',
            mode: 'cors',
            headers: { Authorization: 'Basic abc', 'Content-Type': 'application/json' },
        });
        fetchSpy.mockRestore();
    });
});
