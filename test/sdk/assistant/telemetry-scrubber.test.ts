import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import { REDACTED, ScrubbingSpanProcessor, scrubAttributes, scrubText } from '@/lib/infrastructure/assistant/telemetry-scrubber';

describe('scrubText', () => {
    describe('fix round 5', () => {
        const HEX = '0123456789abcdef0123456789abcdef';

        it('does not let a cookie ending in = swallow the next JSON field', () => {
            const out = scrubText('{"raw":"Cookie: sid=YWJjZA==","password":"hunter 22 x"}');
            expect(out).toBe('{"raw":"Cookie: [REDACTED]","password":"[REDACTED]"}');
        });

        it('redacts Rucio tokens wrapped in punctuation', () => {
            for (const [open, close] of [
                ['`', '`'],
                ['(', ')'],
                ['**', '**'],
                ['[', ']'],
                ['a,', ''],
                ['{t: ', '}'],
            ]) {
                expect(scrubText(`${open}root-root-webui-${HEX}${close}`)).not.toContain(HEX);
            }
        });

        it('redacts x509 tokens whose last DN part contains a space', () => {
            expect(scrubText(`jdoe-/DC=ch/DC=cern/OU=Organic Units/CN=John Doe-unknown-${HEX}`)).not.toContain(HEX);
        });

        it('redacts header tuple and header object values with escaped quotes', () => {
            for (const input of [
                String.raw`[["cookie","sid=\"abc\"; other=secret2"]]`,
                String.raw`{"name":"cookie","value":"sid=\"abc\"; other=secret2"}`,
                String.raw`{"value":"sid=\"abc\"; other=secret2","name":"cookie"}`,
                String.raw`[["authorization","Bearer abcdef\"ghijkl"]]`,
                String.raw`{\"name\":\"cookie\",\"value\":\"sid=\\\"abc\\\"; other=secret2\"}`,
            ]) {
                const out = scrubText(input);
                expect(out).not.toContain('secret2');
                expect(out).not.toContain('ghijkl');
            }
        });

        it('handles cookies two escaping levels deep and JSON escapes inside cookie values', () => {
            expect(scrubText(String.raw`{\"h\":\"Cookie: sid=\\\"abc\\\"; other=secret2\"}`)).not.toMatch(/abc|secret2/);
            expect(scrubText(String.raw`{"h":"Cookie: a=b\\c; other=secret2"}`)).not.toContain('secret2');
            expect(scrubText(String.raw`{"h":"Cookie: a=b\tc; other=secret2"}`)).not.toContain('secret2');
        });

        it('redacts nested arrays under a secret key', () => {
            expect(scrubText('{"set-cookie":[["sid=abc"],"x=secret2"]}')).not.toContain('secret2');
            expect(scrubText('{"token":["a",["b"],"secret2"]}')).not.toContain('secret2');
        });

        it('treats pass, pwd and secret as keys only with = or a quoted key name', () => {
            expect(scrubText("Here's the secret: it works")).toBe("Here's the secret: it works");
            expect(scrubText('pass: hunter22')).toBe('pass: hunter22');
            expect(scrubText('{"secret":"hunter22"}')).toBe('{"secret":"[REDACTED]"}');
            expect(scrubText('pwd=hunter22')).toBe('pwd=[REDACTED]');
        });
    });

    describe('fix round 4', () => {
        const HEX = '0123456789abcdef0123456789abcdef';

        it('redacts quoted cookie values and every later pair (I1)', () => {
            expect(scrubText('Cookie: sid="abcdef"; b=2')).toBe('Cookie: [REDACTED]');
            expect(scrubText(String.raw`{"h":"Cookie: sid=\"abc\"; other=secret2","next":"keep"}`)).toBe(
                String.raw`{"h":"Cookie: [REDACTED]","next":"keep"}`,
            );
            expect(scrubText(String.raw`{\"h\":\"Cookie: a=secret3\",\"o\":\"keep\"}`)).toBe(
                String.raw`{\"h\":\"Cookie: [REDACTED]\",\"o\":\"keep\"}`,
            );
        });

        it('consumes escapes in JSON-in-JSON quoted values (I2)', () => {
            expect(scrubText(String.raw`{"args":"{\"password\":\"a\\\"b c d\"}"}`)).toBe(String.raw`{"args":"{\"password\":\"[REDACTED]\"}"}`);
            expect(scrubText(String.raw`{"args":"{\"password\":\"a\\\\b c\",\"n\":1}"}`)).toBe(
                String.raw`{"args":"{\"password\":\"[REDACTED]\",\"n\":1}"}`,
            );
        });

        it('redacts header tuples, cookie header objects and cookie arrays (m1)', () => {
            expect(scrubText('[["x-rucio-auth-token", "abcdefgh"]]')).toBe('[["x-rucio-auth-token", "[REDACTED]"]]');
            expect(scrubText('[["authorization","Bearer abcdefghijkl"]]')).toBe('[["authorization","[REDACTED]"]]');
            expect(scrubText('{"name":"cookie","value":"sid=abc def"}')).toBe('{"name":"cookie","value":"[REDACTED]"}');
            expect(scrubText('{"set-cookie":["sid=abc","x=y"],"ok":1}')).toBe('{"set-cookie":[REDACTED],"ok":1}');
        });

        it('redacts PGP private and secret key blocks (m2)', () => {
            expect(scrubText('a -----BEGIN PGP PRIVATE KEY BLOCK-----\nxyz\n-----END PGP PRIVATE KEY BLOCK----- b')).toBe('a [REDACTED] b');
            expect(scrubText('a -----BEGIN PGP SECRET KEY BLOCK-----\nxyz\n-----END PGP SECRET KEY BLOCK----- b')).toBe('a [REDACTED] b');
        });

        it('treats passphrase, pwd, pass and secret as key names but not words that contain them (m3)', () => {
            expect(scrubText('passphrase=hunter22')).toBe('passphrase=[REDACTED]');
            expect(scrubText('{"pwd":"hunter22"}')).toBe('{"pwd":"[REDACTED]"}');
            expect(scrubText('"pass": hunter22')).toBe('"pass": [REDACTED]');
            expect(scrubText('secret=hunter22')).toBe('secret=[REDACTED]');
            expect(scrubText('the passage of the secretary was bypassed')).toBe('the passage of the secretary was bypassed');
        });

        it('redacts cookie values with a leading separator or words before the pair (m4)', () => {
            expect(scrubText('Cookie: ;sid=secret')).not.toContain('secret');
            expect(scrubText('Cookie: my sid=secret')).not.toContain('secret');
        });

        it('keeps DID and RSE names that contain a 32 hex run (O1)', () => {
            for (const did of [`user.jdoe:run-v2-${HEX}.root`, `SITE-token-${HEX}`, `user.jdoe:SITE-token-${HEX}`, `user.jdoe:log-task-${HEX}.tgz`]) {
                expect(scrubText(`list ${did} now`)).toBe(`list ${did} now`);
            }
        });

        it('still redacts standalone Rucio tokens (O1)', () => {
            expect(scrubText(`use root-root-webui-${HEX}.`)).toBe('use [REDACTED].');
            expect(scrubText(`{"t":"root-ddmadmin-webui-${HEX}"}`)).toBe('{"t":"[REDACTED]"}');
            expect(scrubText(String.raw`{\"t\":\"root-root-webui-${HEX}\"}`)).toBe(String.raw`{\"t\":\"[REDACTED]\"}`);
            expect(scrubText(`Bearer root-root-webui-${HEX}`)).toBe('Bearer [REDACTED]');
            expect(scrubText(`jdoe-/DC=ch/OU=Organic Units/CN=jdoe-webui-${HEX}`)).not.toContain(HEX);
        });
    });

    it('redacts a quoted value with escaped quotes completely', () => {
        expect(scrubText('{"password":"a\\"b c d","next":"ok"}')).toBe('{"password":"[REDACTED]","next":"ok"}');
        expect(scrubText('{"password":"a\\\\"}, "next":"ok"')).toBe('{"password":"[REDACTED]"}, "next":"ok"');
    });

    it('redacts cookie header values without eating the rest of a JSON attribute or prose', () => {
        expect(scrubText('{"h":"Cookie: a=x; b=y","other":"keep me"}')).toBe('{"h":"Cookie: [REDACTED]","other":"keep me"}');
        expect(scrubText('Set-Cookie: session=abc123; Path=/')).toBe('Set-Cookie: [REDACTED]');
        expect(scrubText('accept the cookie banner')).toBe('accept the cookie banner');
    });

    it('redacts an authorization header value once', () => {
        expect(scrubText('authorization: Bearer abc123def456ghi')).toBe('authorization: Bearer [REDACTED]');
        expect(scrubText('proxy-authorization: Basic cGs6c2sxMjM0NQ==')).toBe('proxy-authorization: Basic [REDACTED]');
    });

    it('redacts PGP private key blocks', () => {
        expect(scrubText('-----BEGIN PGP PRIVATE KEY BLOCK-----\nabc\n-----END PGP PRIVATE KEY BLOCK-----')).toBe('[REDACTED]');
    });

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
        ['cookie double escaped openers', 'Cookie: a=\\\\\\"'.repeat(5000)],
        ['cookie json escapes', `Cookie: a=${'\\\\t'.repeat(26000)}`],
        ['escaped header object openers', '\\"name\\":\\"cookie\\",\\"value\\":\\"'.repeat(2000)],
        ['value first openers', '"value":"a","name":"x",'.repeat(3500)],
        ['nested secret arrays', `"token":[${'[a],'.repeat(20000)}`],
        ['dn equals with spaces', '=a b'.repeat(20000)],
        ['tokens in backticks', '`root-'.repeat(13000)],
        ['cookie quoted openers', 'Cookie: a="'.repeat(7000)],
        ['cookie escaped quoted openers', 'Cookie: a=\\"'.repeat(6000)],
        ['cookie escaped opener without close', `Cookie: a=\\"${'b'.repeat(80000)}`],
        ['escaped quoted value with backslashes', `\\"password\\":\\"${'\\\\'.repeat(80000)}`],
        ['escaped quoted openers', '\\"password\\":\\"'.repeat(5000)],
        ['secret array openers', '"token":['.repeat(8000)],
        ['header tuple openers', '[["cookie","'.repeat(6500)],
        ['token parts', 'root-'.repeat(16000)],
        ['token parts with hex', `root-root-${'0123456789abcdef-'.repeat(4500)}`],
        ['dn slashes', 'a/'.repeat(40000)],
        ['dn equals and hyphens', 'a=b-'.repeat(20000)],
        ['pgp secret key starts', '-----BEGIN PGP SECRET KEY BLOCK-----'.repeat(2100)],
        ['new key names', 'pass pwd secret passphrase '.repeat(3000)],
        ['raw quoted value with escapes', `"password":"${'a\\"'.repeat(26000)}`],
        ['repeated raw quoted openers', '"password":"'.repeat(6500)],
        ['backslash run in a quoted value', `"password":"${'\\'.repeat(80000)}`],
        ['cookie name=value lines', 'Cookie: a=b'.repeat(7000)],
        ['pgp key starts', '-----BEGIN PGP PRIVATE KEY BLOCK-----'.repeat(2100)],
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
        expect(exported.events[0].attributes).toEqual({ header: 'Authorization: Bearer [REDACTED]' });
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
