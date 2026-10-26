import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import { JsonTraceSerializer } from '@opentelemetry/otlp-transformer';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { ATTR_LANGFUSE_OBSERVATION_TYPE, ATTR_LANGFUSE_TRACE_NAME } from '@/lib/infrastructure/assistant/telemetry-attributes';
import type { OtlpTarget, TelemetryTestResult } from '@/lib/infrastructure/assistant/telemetry-sinks';

export const TELEMETRY_TEST_SPAN_NAME = 'Rucio bot test';
export const TELEMETRY_TEST_TIMEOUT_MS = 10000;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** OTLP/HTTP JSON body with one ended test span. */
export async function buildTestSpanPayload(): Promise<Uint8Array> {
    const exporter = new InMemorySpanExporter();
    const provider = new TracerProvider({
        resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'rucio-webui' }),
        spanProcessors: [new SimpleSpanProcessor({ exporter })],
    });
    const span = provider.getTracer('rucio-webui-assistant').startSpan(TELEMETRY_TEST_SPAN_NAME, {
        attributes: { [ATTR_LANGFUSE_TRACE_NAME]: TELEMETRY_TEST_SPAN_NAME, [ATTR_LANGFUSE_OBSERVATION_TYPE]: 'span' },
    });
    span.end();
    const payload = JsonTraceSerializer.serializeRequest(exporter.getFinishedSpans());
    await provider.shutdown();
    if (!payload) {
        throw new Error('Could not serialize the test span');
    }
    return payload;
}

export interface TestTelemetryExportOptions {
    fetchImpl?: typeof fetch;
    /** Protocol of the page, for the mixed content check. Defaults to window.location.protocol. */
    pageProtocol?: string;
    timeoutMs?: number;
}

/**
 * Posts one test span straight to the sink with fetch (no exporter retries), so CORS,
 * credentials and path problems surface at once and map to a hint.
 */
export async function testTelemetryExport(target: OtlpTarget, options: TestTelemetryExportOptions = {}): Promise<TelemetryTestResult> {
    let url: URL;
    try {
        url = new URL(target.url);
    } catch {
        return { ok: false, reason: 'invalid-url' };
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        return { ok: false, reason: 'invalid-url' };
    }
    const pageProtocol = options.pageProtocol ?? globalThis.location?.protocol;
    if (pageProtocol === 'https:' && url.protocol === 'http:' && !LOCAL_HOSTS.has(url.hostname)) {
        return { ok: false, reason: 'mixed-content' };
    }
    const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TELEMETRY_TEST_TIMEOUT_MS);
    try {
        const body = await buildTestSpanPayload();
        const response = await fetchImpl(url.href, {
            method: 'POST',
            headers: { ...target.headers, 'Content-Type': 'application/json' },
            body,
            mode: 'cors',
            credentials: 'omit',
            signal: controller.signal,
        });
        if (response.ok) {
            return { ok: true, status: response.status };
        }
        if (response.status === 401 || response.status === 403) {
            return { ok: false, reason: 'unauthorized', status: response.status };
        }
        if (response.status === 404) {
            return { ok: false, reason: 'not-found', status: response.status };
        }
        return { ok: false, reason: 'http-error', status: response.status };
    } catch {
        if (controller.signal.aborted) {
            return { ok: false, reason: 'timeout' };
        }
        return { ok: false, reason: 'network' };
    } finally {
        clearTimeout(timer);
    }
}
