import type { Attributes, AttributeValue, Context } from '@opentelemetry/api';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace';

export const REDACTED = '[REDACTED]';

/** Runtime secrets shorter than this are not replaced verbatim (too many false positives). */
export const MIN_KNOWN_SECRET_LENGTH = 8;

const SECRET_KEY_NAMES = [
    'x-api-key',
    'api[-_]?key',
    'apikey',
    'x-rucio-auth-token',
    'rucio[-_]?auth[-_]?token',
    'authorization',
    'proxy-authorization',
    'secret[-_]?key',
    'client[-_]?secret',
    'password',
    'passwd',
    'access[-_]?token',
    'refresh[-_]?token',
    'id[-_]?token',
    'token',
].join('|');

/** Pattern rules, applied in order. Each replacement keeps enough context to read the trace. */
const SCRUB_RULES: ReadonlyArray<readonly [RegExp, string]> = [
    // Authorization header values: `Bearer x`, `Basic x`, `Token x`
    [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
    // key: value, key=value, "key": "value" for secret-looking key names (JSON, headers, query strings)
    [new RegExp(`(\\b(?:${SECRET_KEY_NAMES})\\b["']?\\s*[:=]\\s*["']?)(?!\\[REDACTED\\])[^"'\\s,;&}]+`, 'gi'), `$1${REDACTED}`],
    // Provider and Langfuse keys: sk-..., sk-proj-..., sk-ant-..., sk-lf-..., pk-lf-...
    [/\b(?:sk|pk)-[A-Za-z0-9_-]{16,}/g, REDACTED],
    // JWTs (OIDC access and id tokens)
    [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, REDACTED],
    // Rucio tokens: <account>-<identity>-<appid>-<32 hex uuid> (rucio/core/authentication.py)
    // Quantifiers are bounded so long inputs (content attributes up to 8000 chars) cannot make this quadratic.
    [/[^\s"'<>]{0,256}-[A-Za-z0-9_.:]{1,256}-[0-9a-f]{32}(?![0-9a-f])/g, REDACTED],
];

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replaces secrets in a string: known runtime secrets first, then pattern rules. */
export function scrubText(text: string, knownSecrets: readonly string[] = []): string {
    let result = text;
    const secrets = [...new Set(knownSecrets.filter(secret => secret.length >= MIN_KNOWN_SECRET_LENGTH))].sort((a, b) => b.length - a.length);
    for (const secret of secrets) {
        result = result.replace(new RegExp(escapeRegExp(secret), 'g'), REDACTED);
    }
    for (const [pattern, replacement] of SCRUB_RULES) {
        result = result.replace(pattern, replacement);
    }
    return result;
}

export function scrubAttributeValue(value: AttributeValue | undefined, knownSecrets: readonly string[]): AttributeValue | undefined {
    if (typeof value === 'string') {
        return scrubText(value, knownSecrets);
    }
    if (Array.isArray(value)) {
        return value.map(item => (typeof item === 'string' ? scrubText(item, knownSecrets) : item)) as AttributeValue;
    }
    return value;
}

export function scrubAttributes(attributes: Attributes | undefined, knownSecrets: readonly string[]): Attributes {
    const result: Attributes = {};
    for (const [key, value] of Object.entries(attributes ?? {})) {
        result[key] = scrubAttributeValue(value, knownSecrets);
    }
    return result;
}

/** A scrubbed copy of an ended span. The original span is not modified. */
export function scrubSpan(span: ReadableSpan, knownSecrets: readonly string[]): ReadableSpan {
    return {
        name: scrubText(span.name, knownSecrets),
        kind: span.kind,
        spanContext: () => span.spanContext(),
        parentSpanContext: span.parentSpanContext,
        startTime: span.startTime,
        endTime: span.endTime,
        status: span.status.message === undefined ? span.status : { ...span.status, message: scrubText(span.status.message, knownSecrets) },
        attributes: scrubAttributes(span.attributes, knownSecrets),
        links: span.links.map(link => ({ ...link, attributes: link.attributes ? scrubAttributes(link.attributes, knownSecrets) : undefined })),
        events: span.events.map(event => ({
            ...event,
            name: scrubText(event.name, knownSecrets),
            attributes: event.attributes ? scrubAttributes(event.attributes, knownSecrets) : undefined,
        })),
        duration: span.duration,
        ended: span.ended,
        resource: span.resource,
        instrumentationScope: span.instrumentationScope,
        droppedAttributesCount: span.droppedAttributesCount,
        droppedEventsCount: span.droppedEventsCount,
        droppedLinksCount: span.droppedLinksCount,
    };
}

/**
 * Wraps the processor that feeds an exporter, so every span is scrubbed before any exporter
 * sees it. `knownSecrets` is read per span, so keys added in settings apply immediately.
 */
export class ScrubbingSpanProcessor implements SpanProcessor {
    constructor(private readonly next: SpanProcessor, private readonly knownSecrets: () => readonly string[]) {}

    onStart(span: Span, parentContext: Context): void {
        this.next.onStart(span, parentContext);
    }

    onEnd(span: ReadableSpan): void {
        this.next.onEnd(scrubSpan(span, this.knownSecrets()));
    }

    forceFlush(): Promise<void> {
        return this.next.forceFlush();
    }

    shutdown(): Promise<void> {
        return this.next.shutdown();
    }
}
