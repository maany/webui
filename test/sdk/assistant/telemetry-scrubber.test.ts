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
        ['hyphen run', '-'.repeat(8000)],
        ['hyphen separated words', 'ab-'.repeat(2700)],
        ['hex and hyphens', 'a-0123456789abcdef-'.repeat(420)],
        ['key name then spaces', `token${' '.repeat(8000)}x`],
        ['repeated key names', 'token '.repeat(1300)],
        ['bearer then spaces', `Bearer${' '.repeat(8000)}!`],
        ['repeated bearer', 'Bearer ab '.repeat(800)],
        ['near jwt', `eyJ${'a'.repeat(7990)}`],
        ['near jwt segments', `eyJaaaaa.${'b'.repeat(7980)}`],
        ['near key', `sk-${'a'.repeat(7990)}`],
    ])('finishes fast on a long adversarial string: %s', (_label, input) => {
        const started = Date.now();
        scrubText(input, ['localsecret123']);
        expect(Date.now() - started).toBeLessThan(150);
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
        expect(exported.status.message).toBe('failed with key [REDACTED]');
        expect(exported.spanContext().spanId).toBe(span.spanContext().spanId);
        await provider.shutdown();
    });
});
