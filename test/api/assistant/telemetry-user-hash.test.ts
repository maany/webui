import { createHmac } from 'crypto';
import { USER_ID_ATTRIBUTE_KEYS, hashAccountKey, rewriteOtlpUserIds } from '@/lib/infrastructure/assistant/telemetry-user-hash';

const SALT = 'a-long-operator-salt-0123';
const ACCOUNT = 'jdoe@def';
const HASH = createHmac('sha256', SALT).update(ACCOUNT).digest('hex');
const IDS = { accountKeys: [ACCOUNT], hashedIds: { [ACCOUNT]: HASH }, defaultHashedUserId: HASH };
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
        const out = rewriteOtlpUserIds(payload(ACCOUNT), IDS) as ReturnType<typeof payload>;
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
        const out = rewriteOtlpUserIds(payload('mallory@def'), IDS) as ReturnType<typeof payload>;
        const [span] = out.resourceSpans[0].scopeSpans[0].spans;
        expect(span.attributes.slice(0, 2)).toEqual([
            { key: 'user.id', value: str(HASH) },
            { key: 'langfuse.user.id', value: str(HASH) },
        ]);
        expect(span.events[0].attributes[0]).toEqual({ key: 'rucio.assistant.approval.approver', value: str(HASH) });
    });

    it('leaves anything that is not a trace export alone', () => {
        expect(rewriteOtlpUserIds({ note: ACCOUNT }, IDS)).toEqual({ note: ACCOUNT });
        expect(rewriteOtlpUserIds(null, IDS)).toBeNull();
    });

    it('keeps each session account on its own hash and sets foreign ids to the active hash', () => {
        const other = 'asmith@def';
        const otherHash = createHmac('sha256', SALT).update(other).digest('hex');
        const ids = { accountKeys: [ACCOUNT, other], hashedIds: { [ACCOUNT]: HASH, [other]: otherHash }, defaultHashedUserId: HASH };
        const out = rewriteOtlpUserIds(payload(other), ids) as ReturnType<typeof payload>;
        const text = JSON.stringify(out);
        expect(text).not.toContain(other);
        expect(text).not.toContain(ACCOUNT);
        const [span] = out.resourceSpans[0].scopeSpans[0].spans;
        expect(span.attributes.slice(0, 2)).toEqual([
            { key: 'user.id', value: str(otherHash) },
            { key: 'langfuse.user.id', value: str(otherHash) },
        ]);
        const foreign = rewriteOtlpUserIds(payload('mallory@def'), ids) as ReturnType<typeof payload>;
        expect(foreign.resourceSpans[0].scopeSpans[0].spans[0].attributes[0]).toEqual({ key: 'user.id', value: str(HASH) });
    });

    it('replaces the longer account key first when one key contains another', () => {
        const long = 'jdoe@def2';
        const ids = { accountKeys: [ACCOUNT, long], hashedIds: { [ACCOUNT]: 'H1', [long]: 'H2' }, defaultHashedUserId: 'H1' };
        const out = rewriteOtlpUserIds({ resourceSpans: [{ scopeSpans: [{ spans: [{ name: `a ${long} b ${ACCOUNT}` }] }] }] }, ids) as {
            resourceSpans: { scopeSpans: { spans: { name: string }[] }[] }[];
        };
        expect(out.resourceSpans[0].scopeSpans[0].spans[0].name).toBe('a H2 b H1');
    });

    it('does not overflow the stack on deeply nested values', () => {
        let value: unknown = str(ACCOUNT);
        for (let i = 0; i < 5000; i += 1) value = { arrayValue: { values: [value] } };
        const deep = { resourceSpans: [{ scopeSpans: [{ spans: [{ attributes: [{ key: 'deep', value }] }] }] }] };
        const out = rewriteOtlpUserIds(deep, IDS);
        expect(JSON.stringify(out)).not.toContain(ACCOUNT);
    });
});
