import { collectKnownSecrets, langfuseBaseUrl, operatorRelayTarget, userSinkTarget } from '@/lib/infrastructure/assistant/telemetry-sinks';
import { formatOtlpHeaders, parseOtlpHeaders } from '@/lib/infrastructure/assistant/otlp-headers';
import type { AssistantSettings } from '@/lib/core/entity/assistant/settings';

describe('userSinkTarget', () => {
    it('builds the Langfuse OTLP URL and Basic auth from the keys', () => {
        const target = userSinkTarget({ kind: 'langfuse', endpoint: 'https://cloud.langfuse.com/', publicKey: 'pk-lf-x', secretKey: 'sk-lf-y' });
        expect(target).toEqual({
            url: 'https://cloud.langfuse.com/api/public/otel/v1/traces',
            headers: { Authorization: `Basic ${btoa('pk-lf-x:sk-lf-y')}`, 'x-langfuse-ingestion-version': '4' },
        });
    });

    it.each(['https://lf.example.org', 'https://lf.example.org/api/public/otel', 'https://lf.example.org/api/public/otel/v1/traces/'])(
        'accepts the Langfuse URL %s',
        endpoint => {
            expect(langfuseBaseUrl(endpoint)).toBe('https://lf.example.org');
        },
    );

    it('drops user headers that would override the Langfuse auth or version, in any case', () => {
        const target = userSinkTarget({
            kind: 'langfuse',
            endpoint: 'https://lf.example.org',
            publicKey: 'pk',
            secretKey: 'sk',
            headers: { authorization: 'Bearer evil', 'X-Langfuse-Ingestion-Version': '1', 'x-team': 'ddm' },
        });
        expect(target.headers).toEqual({
            'x-team': 'ddm',
            Authorization: `Basic ${btoa('pk:sk')}`,
            'x-langfuse-ingestion-version': '4',
        });
    });

    it('uses the OTLP URL and headers as given', () => {
        expect(userSinkTarget({ kind: 'otlp', endpoint: ' https://otel.example.org/v1/traces ', headers: { 'x-team': 'ddm' } })).toEqual({
            url: 'https://otel.example.org/v1/traces',
            headers: { 'x-team': 'ddm' },
        });
    });
});

describe('operatorRelayTarget', () => {
    it('is an absolute same-origin URL without credentials', () => {
        expect(operatorRelayTarget('https://rucio-ui.example.org')).toEqual({
            url: 'https://rucio-ui.example.org/api/assistant/telemetry',
            headers: {},
        });
    });
});

describe('collectKnownSecrets', () => {
    it('collects provider keys, sink keys, header values and the Basic credential', () => {
        const settings = {
            providers: [
                { id: '1', kind: 'openai', label: 'o', model: 'gpt', apiKey: 'sk-provider-key-123' },
                { id: '2', kind: 'ollama', label: 'l', model: 'llama3' },
            ],
            telemetry: {
                enabled: true,
                contentLevel: 'metadata',
                shareWithOperator: false,
                sink: {
                    kind: 'langfuse',
                    endpoint: 'https://cloud.langfuse.com',
                    publicKey: 'pk-lf-x',
                    secretKey: 'sk-lf-y',
                    headers: { 'x-extra': 'extra-secret' },
                },
            },
        } as unknown as AssistantSettings;
        expect(new Set(collectKnownSecrets(settings))).toEqual(
            new Set(['sk-provider-key-123', 'sk-lf-y', 'pk-lf-x', 'extra-secret', btoa('pk-lf-x:sk-lf-y')]),
        );
    });

    it('adds trimmed, after-first-space and URL-encoded forms, deduplicated', () => {
        const settings = {
            providers: [{ id: '1', kind: 'openai', label: 'o', model: 'gpt', apiKey: '  key with/space+x  ' }],
            telemetry: {
                enabled: true,
                contentLevel: 'metadata',
                shareWithOperator: false,
                sink: { kind: 'otlp', endpoint: 'https://o.example', headers: { Authorization: 'Bearer tokenvalue123', again: 'tokenvalue123' } },
            },
        } as unknown as AssistantSettings;
        const secrets = collectKnownSecrets(settings);
        expect(secrets).toEqual(expect.arrayContaining(['key with/space+x', 'with/space+x', encodeURIComponent('key with/space+x')]));
        expect(secrets).toEqual(expect.arrayContaining(['Bearer tokenvalue123', 'tokenvalue123', encodeURIComponent('Bearer tokenvalue123')]));
        expect(secrets.filter(secret => secret === 'tokenvalue123')).toHaveLength(1);
    });
});

describe('parseOtlpHeaders', () => {
    it('parses k=v pairs and keeps = inside values', () => {
        expect(parseOtlpHeaders('Authorization=Basic cGs6c2s=, x-langfuse-ingestion-version=4')).toEqual({
            Authorization: 'Basic cGs6c2s=',
            'x-langfuse-ingestion-version': '4',
        });
    });

    it('decodes percent-encoded values and skips broken entries', () => {
        expect(parseOtlpHeaders('Authorization=Basic%20abc,novalue,=nokey,,bad=%E0%A4%A')).toEqual({ Authorization: 'Basic abc', bad: '%E0%A4%A' });
    });

    it('returns an empty map for undefined or empty input', () => {
        expect(parseOtlpHeaders(undefined)).toEqual({});
        expect(parseOtlpHeaders('')).toEqual({});
    });

    it('round-trips with formatOtlpHeaders', () => {
        const headers = { a: '1', b: 'x=y' };
        expect(parseOtlpHeaders(formatOtlpHeaders(headers))).toEqual(headers);
    });

    it('encodes percent and comma in values so they round-trip', () => {
        const headers = { a: '100%', b: 'x,y=z', c: 'Basic%20abc' };
        expect(formatOtlpHeaders(headers)).toBe('a=100%25,b=x%2Cy=z,c=Basic%2520abc');
        expect(parseOtlpHeaders(formatOtlpHeaders(headers))).toEqual(headers);
    });
});
