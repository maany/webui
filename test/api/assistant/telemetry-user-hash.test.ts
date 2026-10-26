import { createHmac } from 'crypto';
import { USER_ID_ATTRIBUTE_KEYS, hashAccountKey, rewriteOtlpUserIds } from '@/lib/infrastructure/assistant/telemetry-user-hash';

const SALT = 'a-long-operator-salt-0123';
const ACCOUNT = 'jdoe@def';
const HASH = createHmac('sha256', SALT).update(ACCOUNT).digest('hex');
const str = (stringValue: string) => ({ stringValue });

/** An OTLP/HTTP JSON export as the browser exporter posts it, with the account in many places. */
function payload(userId: string) {
    return {
        resourceSpans: [
            {
                resource: {
                    attributes: [
                        { key: 'service.name', value: str('rucio-webui') },
                        { key: 'user.id', value: str(userId) },
                    ],
                },
                scopeSpans: [
                    {
                        scope: { name: 'rucio-webui-assistant' },
                        spans: [
                            {
                                name: `invoke_agent Rucio bot for ${userId}`,
                                attributes: [
                                    { key: 'user.id', value: str(userId) },
                                    { key: 'langfuse.user.id', value: str(userId) },
                                    { key: 'langfuse.trace.input', value: str(`Which rules does ${userId} own?`) },
                                    { key: 'langfuse.trace.tags', value: { arrayValue: { values: [str('rucio-bot'), str(userId)] } } },
                                    { key: 'rucio.assistant.usage.input_tokens', value: { intValue: 12 } },
                                ],
                                events: [
                                    {
                                        name: 'tool.approval',
                                        attributes: [
                                            { key: 'rucio.assistant.approval.approver', value: str(userId) },
                                            { key: 'details', value: { kvlistValue: { values: [{ key: 'who', value: str(userId) }] } } },
                                        ],
                                    },
                                ],
                                links: [{ attributes: [{ key: 'user.id', value: str(userId) }] }],
                                status: { code: 2, message: `failed for ${userId}` },
                            },
                        ],
                    },
                ],
            },
        ],
    };
}

describe('hashAccountKey', () => {
    it('is the lowercase hex HMAC-SHA256 of the account keyed with the salt', () => {
        expect(hashAccountKey(SALT, ACCOUNT)).toBe(HASH);
        expect(HASH).toMatch(/^[0-9a-f]{64}$/);
        expect(hashAccountKey('another-operator-salt-99', ACCOUNT)).not.toBe(HASH);
    });

    it('covers every attribute the mapper fills with the account', () => {
        expect(USER_ID_ATTRIBUTE_KEYS).toEqual(['user.id', 'langfuse.user.id', 'rucio.assistant.approval.approver']);
    });
});

describe('rewriteOtlpUserIds', () => {
    it('replaces user ids and every other occurrence of the account in resource, span, event and link data', () => {
        const out = rewriteOtlpUserIds(payload(ACCOUNT), { accountKey: ACCOUNT, hashedUserId: HASH }) as ReturnType<typeof payload>;
        expect(JSON.stringify(out)).not.toContain(ACCOUNT);
        const [resourceSpans] = out.resourceSpans;
        const [span] = resourceSpans.scopeSpans[0].spans;
        expect(resourceSpans.resource.attributes).toEqual([
            { key: 'service.name', value: str('rucio-webui') },
            { key: 'user.id', value: str(HASH) },
        ]);
        expect(span.name).toBe(`invoke_agent Rucio bot for ${HASH}`);
        expect(span.attributes).toEqual([
            { key: 'user.id', value: str(HASH) },
            { key: 'langfuse.user.id', value: str(HASH) },
            { key: 'langfuse.trace.input', value: str(`Which rules does ${HASH} own?`) },
            { key: 'langfuse.trace.tags', value: { arrayValue: { values: [str('rucio-bot'), str(HASH)] } } },
            { key: 'rucio.assistant.usage.input_tokens', value: { intValue: 12 } },
        ]);
        expect(span.events[0].attributes).toEqual([
            { key: 'rucio.assistant.approval.approver', value: str(HASH) },
            { key: 'details', value: { kvlistValue: { values: [{ key: 'who', value: str(HASH) }] } } },
        ]);
        expect(span.links[0].attributes).toEqual([{ key: 'user.id', value: str(HASH) }]);
        expect(span.status).toEqual({ code: 2, message: `failed for ${HASH}` });
    });

    it('sets user ids to the session hash even when the browser sent another id', () => {
        const out = rewriteOtlpUserIds(payload('mallory@def'), { accountKey: ACCOUNT, hashedUserId: HASH }) as ReturnType<typeof payload>;
        const [span] = out.resourceSpans[0].scopeSpans[0].spans;
        expect(span.attributes.slice(0, 2)).toEqual([
            { key: 'user.id', value: str(HASH) },
            { key: 'langfuse.user.id', value: str(HASH) },
        ]);
        expect(span.events[0].attributes[0]).toEqual({ key: 'rucio.assistant.approval.approver', value: str(HASH) });
    });

    it('leaves anything that is not a trace export alone', () => {
        expect(rewriteOtlpUserIds({ note: ACCOUNT }, { accountKey: ACCOUNT, hashedUserId: HASH })).toEqual({ note: ACCOUNT });
        expect(rewriteOtlpUserIds(null, { accountKey: ACCOUNT, hashedUserId: HASH })).toBeNull();
    });
});
