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

/**
 * Rewrites an OTLP/HTTP JSON trace export (ExportTraceServiceRequest) in place and returns it.
 * Every user id attribute becomes `hashedUserId`, whatever the browser sent, and the raw
 * `accountKey` is replaced by `hashedUserId` in span and event names, status messages and all
 * string attribute values (resource, scope, span, event and link attributes, including array
 * and key-value list values). Anything that is not a trace export is returned unchanged.
 */
export function rewriteOtlpUserIds(payload: unknown, ids: { accountKey: string; hashedUserId: string }): unknown {
    function replaceText(text: string): string {
        return ids.accountKey === '' ? text : text.split(ids.accountKey).join(ids.hashedUserId);
    }

    function rewriteValue(value: JsonRecord): void {
        if (typeof value.stringValue === 'string') {
            value.stringValue = replaceText(value.stringValue);
        }
        const arrayValue = value.arrayValue;
        if (isRecord(arrayValue)) {
            records(arrayValue.values).forEach(rewriteValue);
        }
        const kvlistValue = value.kvlistValue;
        if (isRecord(kvlistValue)) {
            rewriteAttributes(kvlistValue.values);
        }
    }

    function rewriteAttributes(attributes: unknown): void {
        for (const entry of records(attributes)) {
            if (typeof entry.key === 'string' && USER_ID_ATTRIBUTE_KEYS.includes(entry.key)) {
                entry.value = { stringValue: ids.hashedUserId };
            } else if (isRecord(entry.value)) {
                rewriteValue(entry.value);
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
