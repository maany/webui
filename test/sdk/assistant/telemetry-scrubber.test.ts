import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import { REDACTED, ScrubbingSpanProcessor, scrubAttributes, scrubText } from '@/lib/infrastructure/assistant/telemetry-scrubber';

describe('scrubText', () => {
    it.each([
        ['OpenAI key', 'key sk-abcdefghijklmnopqrstuvwx used', 'key [REDACTED] used'],
        ['OpenAI project key', 'sk-proj-AbCdEf0123456789_-xyz', '[REDACTED]'],
        ['Anthropic key', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz', '[REDACTED]'],
        ['Langfuse keys', 'pk-lf-1234567890abcdef and sk-lf-1234567890abcdef', '[REDACTED] and [REDACTED]'],
        ['Bearer token', 'Bearer abc.def.ghi-123456', 'Bearer [REDACTED]'],
        ['Basic auth', 'basic cGstbGYteDpzay1sZi15', 'basic [REDACTED]'],
        ['x-api-key header', 'x-api-key: abcd1234efgh', 'x-api-key: [REDACTED]'],
        ['JSON api key', '{"apiKey":"abcd1234efgh","model":"gpt"}', '{"apiKey":"[REDACTED]","model":"gpt"}'],
        ['query string token', '/path?token=abcdef123&x=1', '/path?token=[REDACTED]&x=1'],
        ['Rucio auth header', 'X-Rucio-Auth-Token=root-root-webui-0123456789abcdef0123456789abcdef', 'X-Rucio-Auth-Token=[REDACTED]'],
        ['bare Rucio token', 'token root-ddmadmin-webui-0123456789abcdef0123456789abcdef end', 'token [REDACTED] end'],
        ['JWT', 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl', '[REDACTED]'],
    ])('redacts %s', (_label, input, expected) => {
        expect(scrubText(input)).toBe(expected);
    });

    it.each([
        'list_rules for account root',
        '{"max_tokens":1024,"input_tokens":12}',
        'rule 817b3030097446a38b3b842bf528e112 is STUCK',
        'scope:user.jdoe name:data18_13TeV.00348885.physics_Main',
        'SELECT state, count(*) FROM rules_1 GROUP BY state',
    ])('leaves ordinary text alone: %s', input => {
        expect(scrubText(input)).toBe(input);
    });

    it('replaces runtime secrets verbatim, longest first', () => {
        expect(scrubText('my key is localsecret123 and localsecret1234', ['localsecret123', 'localsecret1234'])).toBe(
            `my key is ${REDACTED} and ${REDACTED}`,
        );
    });

    it('ignores runtime secrets shorter than 8 characters', () => {
        expect(scrubText('model llama3', ['llama3'])).toBe('model llama3');
    });

    it('escapes regex characters in runtime secrets', () => {
        expect(scrubText('pass a+b(c)*d$e', ['a+b(c)*d$e'])).toBe(`pass ${REDACTED}`);
    });

    it.each([
        ['hyphen run', '-'.repeat(80000)],
        ['hyphen separated words', 'ab-'.repeat(27000)],
        ['hex and hyphens', 'a-0123456789abcdef-'.repeat(4200)],
        ['key name then spaces', `token${' '.repeat(80000)}x`],
        ['repeated key names', 'token '.repeat(13000)],
        ['bearer then spaces', `Bearer${' '.repeat(80000)}!`],
        ['repeated bearer', 'Bearer ab '.repeat(8000)],
        ['near jwt', `eyJ${'a'.repeat(79990)}`],
        ['near jwt segments', `eyJaaaaa.${'b'.repeat(79980)}`],
        ['near key', `sk-${'a'.repeat(79990)}`],
        ['jwt starts', 'eyJ-'.repeat(20000)],
        ['rucio dot runs', '-a.'.repeat(26666)],
        ['userinfo slashes', '//a:'.repeat(20000)],
        ['userinfo no at', `//${'a'.repeat(80000)}`],
        ['header shape', '{"name":"x-api-key","value":"'.repeat(2500)],
        ['vendor prefixes', 'gsk_'.repeat(20000)],
        ['hf prefixes', 'hf_aaaa'.repeat(11000)],
        ['AIza prefixes', 'AIza'.repeat(20000)],
        ['xai prefixes', 'xai-'.repeat(20000)],
        ['escaped quotes', '\\"token\\": '.repeat(6000)],
        ['bearer percent', 'Bearer%20'.repeat(9000)],
        ['key underscores', 'api_key_'.repeat(10000)],
        ['camel token', 'aToken='.repeat(11000)],
        ['quoted value rule', 'password": "'.repeat(6000)],
        ['quoted value unterminated', `{"password": "${'a b '.repeat(20000)}`],
        ['scheme prefix', 'token: Bearer '.repeat(5500)],
        ['cookie lines', 'cookie: a=b\n'.repeat(6000)],
        ['cookie no newline', 'cookie:'.repeat(11000)],
        ['value before name', '{"value":"'.repeat(8000)],
        ['value before name long', `{"value":"${'a'.repeat(79000)}`],
        ['pem unterminated repeated', '-----BEGIN PRIVATE KEY-----\n'.repeat(2800)],
        ['pem long unterminated', `-----BEGIN RSA PRIVATE KEY-----${'a\n'.repeat(39000)}`],
        ['pem begin spaces', `-----BEGIN ${' '.repeat(79000)}`],
        ['pem begin repeated', '-----BEGIN A '.repeat(6000)],
    ])('finishes fast on a long adversarial string: %s', (_label, input) => {
        const started = Date.now();
        scrubText(input, ['localsecret123']);
        expect(Date.now() - started).toBeLessThan(1000);
    });

    it.each([
        ['JSON-escaped JSON api key', '{"args":"{\\"apiKey\\":\\"abcd1234efgh\\"}"}', '{"args":"{\\"apiKey\\":\\"[REDACTED]\\"}"}'],
        ['escaped token with space', '\\"token\\": \\"supersecretvalue\\"', '\\"token\\": \\"[REDACTED]\\"'],
        ['URL-encoded bearer', 'x=Bearer%20abc123def456', 'x=Bearer [REDACTED]'],
        ['snake case key', 'openai_api_key=abcd1234efgh', 'openai_api_key=[REDACTED]'],
        ['upper case env key', 'ANTHROPIC_API_KEY=abcd1234efgh', 'ANTHROPIC_API_KEY=[REDACTED]'],
        ['camel case key', 'langfuseSecretKey: abcd1234efgh', 'langfuseSecretKey: [REDACTED]'],
        ['auth token', 'auth_token=abcd1234efgh', 'auth_token=[REDACTED]'],
        ['session token', 'sessionToken: abcd1234efgh', 'sessionToken: [REDACTED]'],
        ['private key', 'private_key=abcd1234efgh', 'private_key=[REDACTED]'],
        ['cookie', 'cookie: sid=abcd1234efgh', 'cookie: [REDACTED]'],
        ['set-cookie', 'set-cookie: sid=abcd1234efgh', 'set-cookie: [REDACTED]'],
        ['URL userinfo', 'https://admin:hunter22pass@host.example/x', 'https://admin:[REDACTED]@host.example/x'],
        ['header name value shape', '{"name":"x-api-key","value":"abcd1234efgh"}', '{"name":"x-api-key","value":"[REDACTED]"}'],
        ['header shape authorization', '{"name":"Authorization","value":"Bearer abcd1234"}', '{"name":"Authorization","value":"[REDACTED]"}'],
        ['header shape rucio token', '{"name":"x-rucio-auth-token","value":"abc"}', '{"name":"x-rucio-auth-token","value":"[REDACTED]"}'],
        ['groq key', 'k gsk_abcdefghijklmnopqrstuv k', 'k [REDACTED] k'],
        ['xai key', 'k xai-abcdefghijklmnopqrstuv k', 'k [REDACTED] k'],
        ['hf key', 'k hf_abcdefghijklmnopqrstuv k', 'k [REDACTED] k'],
        ['google key', `k AIza${'a'.repeat(35)} k`, 'k [REDACTED] k'],
    ])('redacts %s', (_label, input, expected) => {
        expect(scrubText(input)).toBe(expected);
    });

    it.each([
        ['letters only bearer after key', 'authorization=bearer abcdefghijklmnop', 'authorization=[REDACTED]'],
        ['letters only bearer in JSON', '{"Authorization":"Bearer abcdefghijklmnopqrst"}', '{"Authorization":"[REDACTED]"}'],
        ['letters only token header', 'Authorization: Token abcdefghijklmnop', 'Authorization: [REDACTED]'],
        ['letters only basic encoded', 'authorization=Basic%20abcdefghijklmnop', 'authorization=[REDACTED]'],
        ['quoted phrase in JSON', '{"password": "correct horse battery staple"}', '{"password": "[REDACTED]"}'],
        ['quoted phrase with comma', '{"password":"a, b; c"}', '{"password":"[REDACTED]"}'],
        ['quoted phrase with equals', 'secret_key = "my long phrase"', 'secret_key = "[REDACTED]"'],
        ['single quoted phrase', "secret_key: 'my long phrase'", "secret_key: '[REDACTED]'"],
        ['escaped quoted phrase', '\\"password\\": \\"correct horse\\"', '\\"password\\": \\"[REDACTED]\\"'],
        ['cookie line', 'Cookie: a=x; b=y\nnext: line', 'Cookie: [REDACTED]\nnext: line'],
        ['set-cookie line', 'set-cookie: sid=x; Path=/; HttpOnly', 'set-cookie: [REDACTED]'],
        ['value before name', '{"value":"abcd1234efgh","name":"authorization"}', '{"value":"[REDACTED]","name":"authorization"}'],
        ['value before name api key', '{"value":"abcd1234efgh","name":"x-api-key"}', '{"value":"[REDACTED]","name":"x-api-key"}'],
        ['value before name rucio', '{"value":"abc","name":"X-Rucio-Auth-Token"}', '{"value":"[REDACTED]","name":"X-Rucio-Auth-Token"}'],
        ['PEM block', 'k -----BEGIN RSA PRIVATE KEY-----\nMIIabc\ndef==\n-----END RSA PRIVATE KEY----- end', 'k [REDACTED] end'],
        ['PEM without end', 'k -----BEGIN PRIVATE KEY-----\nMIIabc', 'k [REDACTED]'],
    ])('redacts %s', (_label, input, expected) => {
        expect(scrubText(input)).toBe(expected);
    });

    it.each([
        '{"inputTokens":12,"outputTokens":3,"cachedInputTokens":5,"maxTokens":100}',
        '{"password_policy": "strong"}',
        'cookies are tasty',
        'Basic authentication is disabled',
        'Token validation failed',
        'see Bearer authentication docs',
        'the token budget is large',
        'a keyboard and a monkey',
    ])('leaves prose alone: %s', input => {
        expect(scrubText(input)).toBe(input);
    });
});

describe('scrubAttributes', () => {
    it('scrubs strings and string arrays and keeps numbers and booleans', () => {
        expect(scrubAttributes({ a: 'Bearer abcdefgh12345', b: ['ok', 'sk-abcdefghijklmnopqrstuvwx'], c: 3, d: true }, [])).toEqual({
            a: 'Bearer [REDACTED]',
            b: ['ok', REDACTED],
            c: 3,
            d: true,
        });
    });
});

describe('ScrubbingSpanProcessor', () => {
    it('scrubs name, attributes, events and status before the exporter sees the span', async () => {
        const exporter = new InMemorySpanExporter();
        const secrets = ['userpasskey99'];
        const provider = new TracerProvider({
            spanProcessors: [new ScrubbingSpanProcessor(new SimpleSpanProcessor({ exporter }), () => secrets)],
        });
        const span = provider.getTracer('test').startSpan('call with sk-abcdefghijklmnopqrstuvwx', {
            attributes: { 'gen_ai.tool.call.arguments': '{"password":"hunter22","note":"userpasskey99"}' },
        });
        span.addEvent('retry', { header: 'Authorization: Bearer abcdefgh12345' });
        span.setStatus({ code: 2, message: 'failed with key userpasskey99' });
        span.end();

        const [exported] = exporter.getFinishedSpans();
        expect(exported.name).toBe('call with [REDACTED]');
        expect(exported.attributes['gen_ai.tool.call.arguments']).toBe('{"password":"[REDACTED]","note":"[REDACTED]"}');
        expect(exported.events[0].attributes).toEqual({ header: 'Authorization: [REDACTED] [REDACTED]' });
        expect(exported.events[0].name).toBe('retry');
        expect(exported.status.message).toBe('failed with key [REDACTED]');
        expect(exported.spanContext().spanId).toBe(span.spanContext().spanId);
        await provider.shutdown();
    });

    const contentSpan = async (processor: (next: SimpleSpanProcessor) => ScrubbingSpanProcessor) => {
        const exporter = new InMemorySpanExporter();
        const provider = new TracerProvider({ spanProcessors: [processor(new SimpleSpanProcessor({ exporter }))] });
        provider
            .getTracer('test')
            .startSpan('s', {
                attributes: {
                    'langfuse.trace.input': 'a',
                    'langfuse.trace.output': 'b',
                    'langfuse.observation.input': 'c',
                    'langfuse.observation.output': 'd',
                    'gen_ai.tool.call.arguments': 'e',
                    'gen_ai.tool.call.result': 'f',
                    'db.query.text': 'g',
                    'gen_ai.tool.name': 'keep',
                },
            })
            .end();
        const spans = exporter.getFinishedSpans();
        await provider.shutdown();
        return spans;
    };

    it('turns a synchronous throw from the wrapped processor into a resolved flush and shutdown', async () => {
        const throwing = {
            onStart: () => undefined,
            onEnd: () => undefined,
            forceFlush: () => {
                throw new Error('flush');
            },
            shutdown: () => {
                throw new Error('shutdown');
            },
        };
        const processor = new ScrubbingSpanProcessor(throwing, () => []);
        await expect(processor.forceFlush()).resolves.toBeUndefined();
        await expect(processor.shutdown()).resolves.toBeUndefined();
    });

    it('drops the span when known secrets cannot be read (fail closed)', async () => {
        const spans = await contentSpan(
            next =>
                new ScrubbingSpanProcessor(next, () => {
                    throw new Error('settings broke');
                }),
        );
        expect(spans).toHaveLength(0);
    });

    it('strips content attributes when stripContent returns true or throws', async () => {
        for (const strip of [
            () => true,
            () => {
                throw new Error('x');
            },
        ]) {
            const [span] = await contentSpan(next => new ScrubbingSpanProcessor(next, () => [], strip));
            expect(Object.keys(span.attributes)).toEqual(['gen_ai.tool.name']);
        }
    });

    it('keeps content attributes when stripContent returns false or is absent', async () => {
        const [withFalse] = await contentSpan(
            next =>
                new ScrubbingSpanProcessor(
                    next,
                    () => [],
                    () => false,
                ),
        );
        expect(Object.keys(withFalse.attributes)).toHaveLength(8);
        const [without] = await contentSpan(next => new ScrubbingSpanProcessor(next, () => []));
        expect(Object.keys(without.attributes)).toHaveLength(8);
    });
});
