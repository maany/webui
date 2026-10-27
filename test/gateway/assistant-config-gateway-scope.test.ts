import AssistantConfigGateway, { ASSISTANT_ENV_KEYS } from '@/lib/infrastructure/gateway/assistant-config-gateway';
import EnvConfigGateway from '@/lib/infrastructure/gateway/env-config-gateway';

const gateway = () => new AssistantConfigGateway(new EnvConfigGateway());

const setEnv = (values: Record<string, string>) => {
    Object.entries({ ASSISTANT_DEFAULT_BASE_URL: 'https://llm.example.org/v1', ASSISTANT_DEFAULT_MODEL: 'main-model', ...values }).forEach(
        ([key, value]) => {
            process.env[key] = value;
        },
    );
};

const scope = async () => (await gateway().getRelayConfig())?.scope;

describe('AssistantConfigGateway relay scope settings', () => {
    afterEach(() => {
        ASSISTANT_ENV_KEYS.forEach(key => {
            delete process.env[key];
        });
    });

    it('reads the three scope variables', () => {
        expect(ASSISTANT_ENV_KEYS).toEqual(expect.arrayContaining(['ASSISTANT_SCOPE_MODE', 'ASSISTANT_SCOPE_EXTRA_TOPICS', 'ASSISTANT_SCOPE_MODEL']));
    });

    it('defaults to warn, no extra topics and the operator default model', async () => {
        setEnv({});
        await expect(scope()).resolves.toEqual({ mode: 'warn', extraTopics: [], model: 'main-model' });
    });

    it.each([
        ['off', 'off'],
        ['BLOCK', 'block'],
        [' Warn ', 'warn'],
        ['strict', 'warn'],
        ['', 'warn'],
    ])('reads ASSISTANT_SCOPE_MODE=%p as %p', async (raw, expected) => {
        setEnv({ ASSISTANT_SCOPE_MODE: raw });
        expect((await scope())?.mode).toBe(expected);
    });

    it('parses extra topics: trimmed, empty dropped, control characters stripped', async () => {
        setEnv({ ASSISTANT_SCOPE_EXTRA_TOPICS: ' ATLAS software , ,CMS\u0007 ops,,' });
        expect((await scope())?.extraTopics).toEqual(['ATLAS software', 'CMS ops']);
    });

    it('caps extra topics at 20 entries of 100 characters', async () => {
        const topics = Array.from({ length: 25 }, (_, index) => `topic${index}`);
        setEnv({ ASSISTANT_SCOPE_EXTRA_TOPICS: [...topics, 'x'.repeat(300)].join(',') });
        const parsed = (await scope())?.extraTopics ?? [];
        expect(parsed).toHaveLength(20);
        setEnv({ ASSISTANT_SCOPE_EXTRA_TOPICS: 'y'.repeat(300) });
        expect((await scope())?.extraTopics).toEqual(['y'.repeat(100)]);
    });

    it('uses ASSISTANT_SCOPE_MODEL when set and falls back to the default model when blank', async () => {
        setEnv({ ASSISTANT_SCOPE_MODEL: ' small-model ' });
        expect((await scope())?.model).toBe('small-model');
        setEnv({ ASSISTANT_SCOPE_MODEL: '   ' });
        expect((await scope())?.model).toBe('main-model');
    });
});
