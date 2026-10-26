import 'server-only';
import { createHmac } from 'crypto';
import { ATTR_LANGFUSE_USER_ID, ATTR_RUCIO_APPROVAL_APPROVER, ATTR_USER_ID } from '@/lib/infrastructure/assistant/telemetry-attributes';

/** Attributes the mapper fills with account@vo (Task 5); the relay sets them to the salted hash of the session account. */
export const USER_ID_ATTRIBUTE_KEYS: readonly string[] = [ATTR_USER_ID, ATTR_LANGFUSE_USER_ID, ATTR_RUCIO_APPROVAL_APPROVER];

/** Lowercase hex HMAC-SHA256 of account@vo keyed with the operator salt (ASSISTANT_TELEMETRY_USER_SALT). Server only. */
export function hashAccountKey(salt: string, accountKey: string): string {
    return createHmac('sha256', salt).update(accountKey).digest('hex');
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function records(value: unknown): JsonRecord[] {
    return Array.isArray(value) ? value.filter(isRecord) : [];
}

export interface OtlpUserIds {
    /** Every `account@vo` of the signed-in session (active and other logged-in accounts). */
    accountKeys: string[];
    /** Salted hash per session account key. */
    hashedIds: Record<string, string>;
    /** Hash of the active account: what any user id that is not a session account becomes. */
    defaultHashedUserId: string;
}

/** Nesting deeper than this is replaced, so a hostile payload cannot exhaust the stack. */
export const OTLP_MAX_DEPTH = 64;

/**
 * Rewrites an OTLP/HTTP JSON trace export (ExportTraceServiceRequest) in place and returns it.
 * Every session account key is replaced by its own hash in span and event names, status messages and
 * all string attribute values (resource, scope, span, event and link attributes, including array and
 * key-value list values), longest key first. A user id attribute whose value is a session account key
 * becomes that key's hash; any other value becomes the active account's hash, so a spoofed id cannot
 * inject a raw id. Values nested deeper than OTLP_MAX_DEPTH are replaced by `{ stringValue: '[REDACTED]' }`.
 * Anything that is not a trace export is returned unchanged.
 */
export function rewriteOtlpUserIds(payload: unknown, ids: OtlpUserIds): unknown {
    const keys = ids.accountKeys.filter(key => key !== '' && ids.hashedIds[key] !== undefined).sort((a, b) => b.length - a.length);

    function replaceText(text: string): string {
        let result = text;
        for (const key of keys) {
            result = result.split(key).join(ids.hashedIds[key]);
        }
        return result;
    }

    function userIdHash(value: unknown): string {
        const raw = isRecord(value) && typeof value.stringValue === 'string' ? value.stringValue : undefined;
        return raw !== undefined && keys.includes(raw) ? ids.hashedIds[raw] : ids.defaultHashedUserId;
    }

    function rewriteValue(value: JsonRecord, depth: number): void {
        if (typeof value.stringValue === 'string') {
            value.stringValue = replaceText(value.stringValue);
        }
        const arrayValue = value.arrayValue;
        if (isRecord(arrayValue)) {
            if (depth >= OTLP_MAX_DEPTH) {
                delete value.arrayValue;
                value.stringValue = '[REDACTED]';
                return;
            }
            records(arrayValue.values).forEach(inner => rewriteValue(inner, depth + 1));
        }
        const kvlistValue = value.kvlistValue;
        if (isRecord(kvlistValue)) {
            if (depth >= OTLP_MAX_DEPTH) {
                delete value.kvlistValue;
                value.stringValue = '[REDACTED]';
                return;
            }
            rewriteAttributes(kvlistValue.values, depth + 1);
        }
    }

    function rewriteAttributes(attributes: unknown, depth = 0): void {
        for (const entry of records(attributes)) {
            if (typeof entry.key === 'string' && USER_ID_ATTRIBUTE_KEYS.includes(entry.key)) {
                entry.value = { stringValue: userIdHash(entry.value) };
            } else if (isRecord(entry.value)) {
                rewriteValue(entry.value, depth);
            }
        }
    }
    if (!isRecord(payload)) {
        return payload;
    }
    for (const resourceSpans of records(payload.resourceSpans)) {
        const resource = resourceSpans.resource;
        if (isRecord(resource)) {
            rewriteAttributes(resource.attributes);
        }
        for (const scopeSpans of records(resourceSpans.scopeSpans)) {
            const scope = scopeSpans.scope;
            if (isRecord(scope)) {
                rewriteAttributes(scope.attributes);
            }
            for (const span of records(scopeSpans.spans)) {
                if (typeof span.name === 'string') {
                    span.name = replaceText(span.name);
                }
                rewriteAttributes(span.attributes);
                const status = span.status;
                if (isRecord(status) && typeof status.message === 'string') {
                    status.message = replaceText(status.message);
                }
                for (const event of records(span.events)) {
                    if (typeof event.name === 'string') {
                        event.name = replaceText(event.name);
                    }
                    rewriteAttributes(event.attributes);
                }
                for (const link of records(span.links)) {
                    rewriteAttributes(link.attributes);
                }
            }
        }
    }
    return payload;
}
