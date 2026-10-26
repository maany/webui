import type { Attributes, AttributeValue, Context } from '@opentelemetry/api';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace';
import {
    ATTR_GEN_AI_TOOL_CALL_ARGUMENTS,
    ATTR_GEN_AI_TOOL_CALL_RESULT,
    ATTR_LANGFUSE_OBSERVATION_INPUT,
    ATTR_LANGFUSE_OBSERVATION_OUTPUT,
    ATTR_LANGFUSE_TRACE_INPUT,
    ATTR_LANGFUSE_TRACE_OUTPUT,
} from '@/lib/infrastructure/assistant/telemetry-attributes';

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
    'passphrase',
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

/** Short key names that are also ordinary words: keys only when quoted (`"secret":`), followed by `=`, or followed by `:` and a quoted value. */
const WEAK_KEY_NAMES = ['pwd', 'pass', 'secret'].join('|');

/** A secret key name, as used by every key based rule below. */
const SECRET_KEY = String.raw`(?:${SECRET_KEY_NAMES}|(?<=["'])(?:${WEAK_KEY_NAMES})(?=\\?["'])|(?:${WEAK_KEY_NAMES})(?=\s*=|\s*:\s*\\?["']))`;

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
// An optional scheme (`Bearer abc`, `Token%20abc`) is part of the value, so letters-only credentials are covered.
const KEY_VALUE_SCHEME = `(?:(?:Bearer|Basic|Token)(?:\\s+|%20))?`;
// The guard sits in front of the optional scheme, so an already redacted `Bearer [REDACTED]` is not redacted twice.
const KEY_VALUE = `(?!${KEY_VALUE_SCHEME}\\[REDACTED\\])${KEY_VALUE_SCHEME}[^"'\\s,;&}\\\\]+`;

const SECRET_HEADER_NAMES = 'x-api-key|authorization|proxy-authorization|x-rucio-auth-token|set-cookie|cookie';

/**
 * Cookie header value: `name=value` pairs. A value may be quoted (`sid="abc"`, `sid=\"abc\"` in a JSON string,
 * `sid=\\\"abc\\\"` in JSON in JSON); a quoted value only counts when a cookie delimiter follows its closing quote, so a
 * value ending in `=` cannot swallow the next JSON field. JSON escapes `\\`, `\t`, `\u` and `\/` are part of the value.
 * Stops at a line end, a raw quote (end of a JSON string) or any other backslash (end of a JSON-in-JSON string).
 * Each alternative scans only to the next quote or backslash, so the rule is linear.
 */
const COOKIE_VALUE = String.raw`(?:=\\\\\\"[^"\\\r\n]*\\\\\\"(?=[;\s]|\\|$)|=\\"[^"\\\r\n]*\\"(?=[;\s"]|\\[rnt"\\]|$)|="[^"\r\n]*"(?=[;\s]|$)|\\(?:\\|t|u|/)|[^\r\n"\\])+`;

/** Inside a raw JSON string: escapes are consumed, the value ends at the closing quote. */
const RAW_QUOTED_VALUE = String.raw`(?:\\[\s\S]|[^"\\])*`;

/**
 * Value after an escaped opening quote (JSON-in-JSON, `\"password\":\"...\"`). Consumes the outer encoding of inner
 * escapes (`\\\"` is an inner escaped quote, `\\\\` an inner backslash) and stops at `\"`, the end of the inner string.
 */
const ESCAPED_QUOTED_VALUE = String.raw`(?:\\\\(?:\\[\s\S]|[^\\])|\\[^"'\\]|(?!\2)[^\\])+`;
/** Same as ESCAPED_QUOTED_VALUE for header shapes, where the quote is always `"`. */
const ESCAPED_HEADER_VALUE = String.raw`(?:\\\\(?:\\[\s\S]|[^\\])|\\[^"\\]|[^"\\])*`;

/** Characters that delimit a standalone token in text, markdown and code. */
const TOKEN_DELIMITERS = String.raw`\s"'<>()\[\]{}\x60*,;|`;

/**
 * A token run starts at a delimiter, the text start or right after a JSON escaped line break or tab (`\n`, `\r`, `\t`).
 * Runs stop at a backslash, so each start scans a disjoint run and the rules stay linear.
 */
const TOKEN_START = String.raw`(?:(?<![^${TOKEN_DELIMITERS}])|(?<=\\[nrt]))`;

/**
 * End of a standalone Rucio token: not followed by more name characters or by `.ext`, so a DID such as
 * `user.jdoe:run-v2-<32 hex>.root` is not mistaken for a token.
 */
const TOKEN_END = String.raw`(?![0-9A-Za-z_-]|\.[A-Za-z0-9_])`;

/**
 * Pattern rules, applied in order. Each replacement keeps enough context to read the trace.
 * Every rule must be linear on long inputs (content attributes can be large): no nested unbounded
 * quantifiers, and each one starts from an anchor so only a few start positions are ever tried.
 */
const SCRUB_RULES: ReadonlyArray<readonly [RegExp, string]> = [
    // Rucio tokens whose last DN part holds spaces (`/CN=John Doe-<appid>-<hex>`): one bounded start after each DN
    // attribute. Runs first, so no key or Bearer rule can cut the token at a space and drop the `/CN=` anchor.
    // `|` ends the run so a DID in the next markdown table cell is kept.
    [new RegExp(String.raw`(?<=/[A-Za-z]{1,16}=)[^\r\n"'<>=/|]{1,128}-[A-Za-z0-9_.:]+-[0-9a-f]{32}${TOKEN_END}`, 'g'), REDACTED],
    // Header objects: {"name":"x-api-key","value":"..."} (raw JSON and JSON in JSON)
    [new RegExp(String.raw`("name"\s*:\s*"(?:${SECRET_HEADER_NAMES})"\s*,\s*"value"\s*:\s*")${RAW_QUOTED_VALUE}`, 'gi'), `$1${REDACTED}`],
    [
        new RegExp(String.raw`(\\"name\\"\s*:\s*\\"(?:${SECRET_HEADER_NAMES})\\"\s*,\s*\\"value\\"\s*:\s*\\")${ESCAPED_HEADER_VALUE}`, 'gi'),
        `$1${REDACTED}`,
    ],
    // Header tuples: [["authorization", "Bearer ..."]], [["x-rucio-auth-token", "..."]] (letters-only values too)
    [new RegExp(String.raw`(\[\s*"(?:${SECRET_HEADER_NAMES})"\s*,\s*")${RAW_QUOTED_VALUE}`, 'gi'), `$1${REDACTED}`],
    [new RegExp(String.raw`(\[\s*\\"(?:${SECRET_HEADER_NAMES})\\"\s*,\s*\\")${ESCAPED_HEADER_VALUE}`, 'gi'), `$1${REDACTED}`],
    // Array values of secret keys: {"set-cookie":["sid=abc","x=y"]}. One nesting level; stops at the next bracket, so scans never overlap.
    [new RegExp(`((?<![A-Za-z0-9])${SECRET_KEY}\\\\?["']?\\s*[:=]\\s*\\[)(?:[^\\][]|\\[[^\\][]*\\])*`, 'gi'), `$1${REDACTED}`],
    // Authorization header values: `Bearer x`, `Basic x`, `Token x` (also `Bearer%20x`). The value must look like
    // a credential (a digit or one of + / = . _ ~ -) so prose such as "Basic authentication" is left alone.
    [/\b(Bearer|Basic|Token)(?:\s+|%20)(?=[A-Za-z0-9._~+/=-]*[0-9+/=._~-])[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
    // Header objects with the value first: {"value":"...","name":"authorization"}
    [new RegExp(String.raw`("value"\s*:\s*")${RAW_QUOTED_VALUE}(?="\s*,\s*"name"\s*:\s*"(?:${SECRET_HEADER_NAMES})")`, 'gi'), `$1${REDACTED}`],
    [
        new RegExp(String.raw`(\\"value\\"\s*:\s*\\")${ESCAPED_HEADER_VALUE}(?=\\"\s*,\s*\\"name\\"\s*:\s*\\"(?:${SECRET_HEADER_NAMES})\\")`, 'gi'),
        `$1${REDACTED}`,
    ],
    // Private key blocks. Consumes to the END marker or, when missing, to the end of the text (one match, so linear).
    [
        /-----BEGIN [A-Z ]*(?:PRIVATE|SECRET) KEY(?: BLOCK)?-----(?:(?!-----END )[\s\S])*(?:-----END [A-Z ]*(?:PRIVATE|SECRET) KEY(?: BLOCK)?-----)?/g,
        REDACTED,
    ],
    // Cookie header lines carry several name=value pairs (see COOKIE_VALUE). Only when a `name=` follows within 256
    // characters (bounded lookahead, so linear); anything else falls through to the key rule.
    [new RegExp(String.raw`((?<![A-Za-z0-9])(?:set-cookie|cookie)[ \t]*:[ \t]*)(?=[^\r\n"\\=]{0,256}=)${COOKIE_VALUE}`, 'gi'), `$1${REDACTED}`],
    // Quoted values with a raw (unescaped) opening quote: consume escapes, so "a\"b c" is redacted to its closing quote.
    [new RegExp(`((?<![A-Za-z0-9])${SECRET_KEY}["']?\\s*[:=]\\s*(["']))(?:\\\\[\\s\\S]|(?!\\2)[^\\\\])+`, 'gi'), `$1${REDACTED}`],
    // Quoted values may hold spaces and commas: "password": "correct horse", secret_key = "a phrase"
    [new RegExp(`((?<![A-Za-z0-9])${SECRET_KEY}\\\\?["']?\\s*[:=]\\s*\\\\?(["']))${ESCAPED_QUOTED_VALUE}`, 'gi'), `$1${REDACTED}`],
    // key: value, key=value, "key": "value" for secret-looking key names (JSON, escaped JSON, headers, query strings)
    [new RegExp(`((?<![A-Za-z0-9])${SECRET_KEY}${KEY_VALUE_SEPARATOR})${KEY_VALUE}`, 'gi'), `$1${REDACTED}`],
    [new RegExp(`((?<=[a-z0-9])(?:${CAMEL_KEY_NAMES})${KEY_VALUE_SEPARATOR})${KEY_VALUE}`, 'g'), `$1${REDACTED}`],
    // URL userinfo: //user:pass@host
    [/(\/\/[^\s/:@"'<>]+:)[^\s/@"'<>]+(?=@)/g, `$1${REDACTED}`],
    // Provider and Langfuse keys: sk-..., sk-proj-..., sk-ant-..., sk-lf-..., pk-lf-...
    [/\b(?:sk|pk)-[A-Za-z0-9_-]{16,}/g, REDACTED],
    // Other vendor keys: Groq, xAI, Hugging Face, Google
    [/(?<![A-Za-z0-9])(?:gsk_[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{35})/g, REDACTED],
    // JWTs (OIDC access and id tokens)
    [/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, REDACTED],
    // Rucio tokens: <account>-<identity>-<appid>-<32 hex uuid> (rucio/core/authentication.py), standalone only: the run
    // starts at a delimiter (whitespace, quotes, brackets, backticks, `*`, `,`, `;`, `|`) or the text start, has at least
    // three parts before the hex, and ends at TOKEN_END. DIDs (scope:name, extensions) and two-part names such as
    // SITE-token-<hex> are kept. Only run starts are tried.
    [new RegExp(String.raw`${TOKEN_START}[A-Za-z0-9_]+-[^${TOKEN_DELIMITERS}\\]*-[A-Za-z0-9_.:]+-[0-9a-f]{32}${TOKEN_END}`, 'g'), REDACTED],
    // Tokens whose identity is an x509 DN or OIDC subject: the run holds a `/` or `=` before the tail. Query strings
    // (`?scope=user.jdoe&name=...`) are not identities, so `?` and `&` end the run. A JSON `\/` (or `\\/` one level
    // deeper) counts as a slash.
    [
        new RegExp(
            String.raw`${TOKEN_START}[^${TOKEN_DELIMITERS}\\:/=?&]*(?:(?:\\\\?)?/|=)(?:\\\\?/|[^${TOKEN_DELIMITERS}\\?&])*-[A-Za-z0-9_.:]+-[0-9a-f]{32}${TOKEN_END}`,
            'g',
        ),
        REDACTED,
    ],
];

/** Content attributes removed when content must not leave the browser (level lowered after capture). */
const CONTENT_ATTRIBUTE_KEYS: readonly string[] = [
    ATTR_LANGFUSE_TRACE_INPUT,
    ATTR_LANGFUSE_TRACE_OUTPUT,
    ATTR_LANGFUSE_OBSERVATION_INPUT,
    ATTR_LANGFUSE_OBSERVATION_OUTPUT,
    ATTR_GEN_AI_TOOL_CALL_ARGUMENTS,
    ATTR_GEN_AI_TOOL_CALL_RESULT,
    // ATTR_DB_QUERY_TEXT from @opentelemetry/semantic-conventions; that is a value import, which the scrubber must not have.
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
        return Promise.resolve()
            .then(() => this.next.forceFlush())
            .catch(() => undefined);
    }

    shutdown(): Promise<void> {
        return Promise.resolve()
            .then(() => this.next.shutdown())
            .catch(() => undefined);
    }
}
