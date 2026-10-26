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
    'auth[-_]?token',
    'session[-_]?token',
    'private[-_]?key',
    'set-cookie',
    'cookie',
    'token',
].join('|');

/** camelCase key names (`langfuseSecretKey`), matched case sensitively after a lower case letter or digit. */
const CAMEL_KEY_NAMES = [
    'SecretKey',
    'ApiKey',
    'ClientSecret',
    'Password',
    'AccessToken',
    'RefreshToken',
    'IdToken',
    'AuthToken',
    'SessionToken',
    'PrivateKey',
    'Token',
    'Cookie',
].join('|');

// After the key name: optional (backslash-escaped) quote, `:` or `=`, optional (escaped) quote.
const KEY_VALUE_SEPARATOR = `\\\\?["']?\\s*[:=]\\s*\\\\?["']?`;
// The value stops at quotes, whitespace, delimiters and backslashes (JSON-escaped JSON).
const KEY_VALUE = `(?!\\[REDACTED\\])[^"'\\s,;&}\\\\]+`;

const SECRET_HEADER_NAMES = 'x-api-key|authorization|proxy-authorization|x-rucio-auth-token';

/**
 * Pattern rules, applied in order. Each replacement keeps enough context to read the trace.
 * Every rule must be linear on long inputs (content attributes can be large): no nested unbounded
 * quantifiers, and each one starts from an anchor so only a few start positions are ever tried.
 */
const SCRUB_RULES: ReadonlyArray<readonly [RegExp, string]> = [
    // Header objects: {"name":"x-api-key","value":"..."}
    [
        new RegExp(`(\\\\?"name\\\\?"\\s*:\\s*\\\\?"(?:${SECRET_HEADER_NAMES})\\\\?"\\s*,\\s*\\\\?"value\\\\?"\\s*:\\s*\\\\?")[^"\\\\]*`, 'gi'),
        `$1${REDACTED}`,
    ],
    // Authorization header values: `Bearer x`, `Basic x`, `Token x` (also `Bearer%20x`). The value must look like
    // a credential (a digit or one of + / = . _ ~ -) so prose such as "Basic authentication" is left alone.
    [/\b(Bearer|Basic|Token)(?:\s+|%20)(?=[A-Za-z0-9._~+/=-]*[0-9+/=._~-])[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
    // key: value, key=value, "key": "value" for secret-looking key names (JSON, escaped JSON, headers, query strings)
    [new RegExp(`((?<![A-Za-z0-9])(?:${SECRET_KEY_NAMES})${KEY_VALUE_SEPARATOR})${KEY_VALUE}`, 'gi'), `$1${REDACTED}`],
    [new RegExp(`((?<=[a-z0-9])(?:${CAMEL_KEY_NAMES})${KEY_VALUE_SEPARATOR})${KEY_VALUE}`, 'g'), `$1${REDACTED}`],
    // URL userinfo: //user:pass@host
    [/(\/\/[^\s/:@"'<>]+:)[^\s/@"'<>]+(?=@)/g, `$1${REDACTED}`],
    // Provider and Langfuse keys: sk-..., sk-proj-..., sk-ant-..., sk-lf-..., pk-lf-...
    [/\b(?:sk|pk)-[A-Za-z0-9_-]{16,}/g, REDACTED],
    // Other vendor keys: Groq, xAI, Hugging Face, Google
    [/(?<![A-Za-z0-9])(?:gsk_[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{35})/g, REDACTED],
    // JWTs (OIDC access and id tokens)
    [/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, REDACTED],
    // Rucio tokens: <account>-<identity>-<appid>-<32 hex uuid> (rucio/core/authentication.py).
    // Anchored at the start of a delimiter-free run, so only one start per run is tried.
    [/(?<![^\s"'<>])[^\s"'<>]*-[A-Za-z0-9_.:]+-[0-9a-f]{32}(?![0-9a-f])/g, REDACTED],
];

/** Content attributes removed when content must not leave the browser (level lowered after capture). */
const CONTENT_ATTRIBUTE_KEYS: readonly string[] = [
    'langfuse.trace.input',
    'langfuse.trace.output',
    'langfuse.observation.input',
    'langfuse.observation.output',
    'gen_ai.tool.call.arguments',
    'gen_ai.tool.call.result',
    'db.query.text',
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

export function scrubAttributes(attributes: Attributes | undefined, knownSecrets: readonly string[], stripContent = false): Attributes {
    const result: Attributes = {};
    for (const [key, value] of Object.entries(attributes ?? {})) {
        if (stripContent && CONTENT_ATTRIBUTE_KEYS.includes(key)) {
            continue;
        }
        result[key] = scrubAttributeValue(value, knownSecrets);
    }
    return result;
}

/** A scrubbed copy of an ended span. The original span is not modified. */
export function scrubSpan(span: ReadableSpan, knownSecrets: readonly string[], stripContent = false): ReadableSpan {
    return {
        name: scrubText(span.name, knownSecrets),
        kind: span.kind,
        spanContext: () => span.spanContext(),
        parentSpanContext: span.parentSpanContext,
        startTime: span.startTime,
        endTime: span.endTime,
        status: span.status.message === undefined ? span.status : { ...span.status, message: scrubText(span.status.message, knownSecrets) },
        attributes: scrubAttributes(span.attributes, knownSecrets, stripContent),
        links: span.links.map(link => ({
            ...link,
            attributes: link.attributes ? scrubAttributes(link.attributes, knownSecrets, stripContent) : undefined,
        })),
        events: span.events.map(event => ({
            ...event,
            name: scrubText(event.name, knownSecrets),
            attributes: event.attributes ? scrubAttributes(event.attributes, knownSecrets, stripContent) : undefined,
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
 * sees it. `knownSecrets` is read per span, so keys added in settings apply immediately. When
 * `stripContent` returns true (or throws) prompt, argument, result and SQL attributes are removed too.
 */
export class ScrubbingSpanProcessor implements SpanProcessor {
    constructor(
        private readonly next: SpanProcessor,
        private readonly knownSecrets: () => readonly string[],
        private readonly stripContent?: () => boolean,
    ) {}

    onStart(span: Span, parentContext: Context): void {
        this.next.onStart(span, parentContext);
    }

    onEnd(span: ReadableSpan): void {
        let secrets: readonly string[];
        try {
            secrets = this.knownSecrets();
        } catch {
            // Fail closed: never forward a span that could not be scrubbed.
            return;
        }
        let strip = false;
        try {
            strip = this.stripContent?.() ?? false;
        } catch {
            strip = true;
        }
        let scrubbed: ReadableSpan;
        try {
            scrubbed = scrubSpan(span, secrets, strip);
        } catch {
            return;
        }
        this.next.onEnd(scrubbed);
    }

    forceFlush(): Promise<void> {
        return this.next.forceFlush();
    }

    shutdown(): Promise<void> {
        return this.next.shutdown();
    }
}
