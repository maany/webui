import { buildTestRequest, testProviderConnection, type ConnectionTestOptions } from '@/lib/infrastructure/assistant/connection-test';
import type { ResolvedProvider } from '@/lib/core/entity/assistant/provider-config';

const openai: ResolvedProvider = { providerId: 'p1', kind: 'openai', model: 'gpt-5.4-mini', apiKey: 'sk-openai', via: 'direct' };
const anthropic: ResolvedProvider = { providerId: 'p2', kind: 'anthropic', model: 'claude-sonnet-5-5', apiKey: 'sk-ant', via: 'direct' };
const ollama: ResolvedProvider = { providerId: 'p3', kind: 'ollama', model: 'qwen3', via: 'direct' };
const litellm: ResolvedProvider = {
    providerId: 'p4',
    kind: 'openai-compatible',
    model: 'gpt-oss-120b',
    baseURL: 'https://litellm.example.org/v1/',
    via: 'direct',
};
const operator: ResolvedProvider = {
    providerId: 'operator',
    kind: 'openai-compatible',
    model: 'gpt-oss-120b',
    baseURL: '/api/assistant/llm',
    via: 'relay',
};
const operatorAnthropic: ResolvedProvider = {
    providerId: 'operator',
    kind: 'anthropic',
    model: 'claude-sonnet-5-5',
    baseURL: '/api/assistant/llm',
    via: 'relay',
};

const respond = (status: number, body = '{}') => jest.fn(async () => new Response(body, { status }));
const failNetwork = () =>
    jest.fn(async () => {
        throw new TypeError('Failed to fetch');
    });
const signal = () => new AbortController().signal;
const run = (resolved: ResolvedProvider, fetchImpl: jest.Mock, options: ConnectionTestOptions = {}) =>
    testProviderConnection(resolved, signal(), { origin: 'http://localhost:3000', fetchImpl: fetchImpl as unknown as typeof fetch, ...options });
const sent = (fetchImpl: jest.Mock) => {
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    return { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
};

describe('buildTestRequest', () => {
    it('sends one tool to OpenAI with a bearer key', () => {
        const request = buildTestRequest(openai)!;
        expect(request.url).toBe('https://api.openai.com/v1/chat/completions');
        expect(request.init.headers).toEqual({ 'content-type': 'application/json', authorization: 'Bearer sk-openai' });
        const body = JSON.parse(String(request.init.body));
        expect(body).toMatchObject({ model: 'gpt-5.4-mini', stream: false, max_completion_tokens: 64 });
        expect(body.tools).toEqual([
            {
                type: 'function',
                function: { name: 'ping', description: 'Connection check. Takes no arguments.', parameters: { type: 'object', properties: {} } },
            },
        ]);
    });

    it('opts in to direct browser access for Anthropic', () => {
        const request = buildTestRequest(anthropic)!;
        expect(request.url).toBe('https://api.anthropic.com/v1/messages');
        expect(request.init.headers).toEqual({
            'content-type': 'application/json',
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
            'x-api-key': 'sk-ant',
        });
        expect(JSON.parse(String(request.init.body))).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 64, tools: [{ name: 'ping' }] });
    });

    it('uses the OpenAI-compatible path of Ollama without doubling /v1', () => {
        expect(buildTestRequest(ollama)!.url).toBe('http://localhost:11434/v1/chat/completions');
        expect(buildTestRequest({ ...ollama, baseURL: 'http://gpu01.lab:11434/v1/' })!.url).toBe('http://gpu01.lab:11434/v1/chat/completions');
        expect(buildTestRequest(ollama)!.init.headers).toEqual({ 'content-type': 'application/json' });
    });

    it('goes through the relay without a key for the operator default', () => {
        expect(buildTestRequest(operator)).toMatchObject({
            url: '/api/assistant/llm/chat/completions',
            init: { headers: { 'content-type': 'application/json' } },
        });
        expect(buildTestRequest(operatorAnthropic)).toMatchObject({
            url: '/api/assistant/llm/v1/messages',
            init: { headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' } },
        });
    });

    it('never sends credentials through the relay, even when a key is present', () => {
        const compat = buildTestRequest({ ...operator, apiKey: 'sk-leak' })!;
        expect(compat.init.headers).toEqual({ 'content-type': 'application/json' });
        const claude = buildTestRequest({ ...operatorAnthropic, apiKey: 'sk-leak' })!;
        expect(claude.init.headers).toEqual({ 'content-type': 'application/json', 'anthropic-version': '2023-06-01' });
    });

    it('has no request for an OpenAI-compatible provider without a base URL', () => {
        expect(buildTestRequest({ ...litellm, baseURL: undefined })).toBeUndefined();
    });
});

describe('testProviderConnection', () => {
    it('reports success with the latency', async () => {
        let t = 1000;
        const result = await run(openai, respond(200), { now: () => (t += 250) });
        expect(result).toEqual({ ok: true, latencyMs: 250 });
    });

    it('calls the relay on the page origin', async () => {
        const fetchImpl = respond(200);
        await run(operator, fetchImpl);
        expect(sent(fetchImpl).url).toBe('http://localhost:3000/api/assistant/llm/chat/completions');
    });

    it('asks for a base URL when an OpenAI-compatible provider has none', async () => {
        const fetchImpl = respond(200);
        await expect(run({ ...litellm, baseURL: undefined }, fetchImpl)).resolves.toEqual({
            ok: false,
            code: 'unknown',
            hint: 'Set a base URL for this provider.',
        });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it.each([401, 403])('maps HTTP %i to auth', async status => {
        await expect(run(anthropic, respond(status))).resolves.toMatchObject({ ok: false, code: 'auth' });
    });

    it('maps a model without tool support to no-tools', async () => {
        const body = '{"error":{"message":"registry.ollama.ai/library/gemma:2b does not support tools"}}';
        await expect(run(ollama, respond(400, body))).resolves.toEqual({
            ok: false,
            code: 'no-tools',
            hint: 'The model "qwen3" does not support tool calling. Choose a model with tool support.',
        });
    });

    it('maps a missing Ollama model to model-not-found with the pull command', async () => {
        await expect(run(ollama, respond(404, '{"error":{"message":"model \\"qwen3\\" not found, try pulling it first"}}'))).resolves.toEqual({
            ok: false,
            code: 'model-not-found',
            hint: 'The model "qwen3" was not found. Run: ollama pull qwen3',
        });
    });

    it('maps a missing OpenAI model to model-not-found', async () => {
        await expect(run(openai, respond(400, '{"error":{"message":"The model `gpt-9` does not exist"}}'))).resolves.toMatchObject({
            ok: false,
            code: 'model-not-found',
        });
    });

    it('suggests checking the base URL for a 404 that is not about the model', async () => {
        await expect(run(litellm, respond(404, 'Not Found'))).resolves.toEqual({
            ok: false,
            code: 'unknown',
            hint: 'The endpoint returned 404. Check the base URL (OpenAI-compatible servers usually end in /v1).',
        });
    });

    it('tells the user the session expired when the relay answers 401', async () => {
        await expect(run(operator, respond(401))).resolves.toEqual({ ok: false, code: 'auth', hint: 'Your session has expired. Log in again.' });
    });

    it('reports a relay that cannot reach the operator model', async () => {
        await expect(run(operator, respond(502))).resolves.toEqual({
            ok: false,
            code: 'network',
            hint: 'The server could not reach the operator model.',
        });
    });

    it('gives the exact OLLAMA_ORIGINS value for a blocked local Ollama', async () => {
        await expect(run(ollama, failNetwork())).resolves.toEqual({
            ok: false,
            code: 'cors',
            hint: 'Could not reach localhost:11434. Is Ollama running? If it is, it may be rejecting requests from this page: start it with OLLAMA_ORIGINS=http://localhost:3000 ollama serve',
        });
    });

    it('reports Local Network Access when a public page calls a local model', async () => {
        const result = await run(ollama, failNetwork(), { origin: 'https://rucio-ui.cern.ch' });
        expect(result).toEqual({
            ok: false,
            code: 'lna',
            hint: 'The browser likely blocked access to localhost:11434 on your local network. Allow local network access when the browser asks, and start Ollama with OLLAMA_ORIGINS=https://rucio-ui.cern.ch',
        });
    });

    it('reports mixed content for plain HTTP from an HTTPS page', async () => {
        const result = await run({ ...ollama, baseURL: 'http://gpu01.lab:11434' }, failNetwork(), { origin: 'https://rucio-ui.cern.ch' });
        expect(result).toMatchObject({ ok: false, code: 'mixed-content' });
        expect(result.ok === false && result.hint).toContain('gpu01.lab:11434');
    });

    it('gives the exact LITELLM_CORS_ORIGINS value for a blocked gateway', async () => {
        const result = await run(litellm, failNetwork(), { origin: 'https://rucio-ui.cern.ch' });
        expect(result).toEqual({
            ok: false,
            code: 'cors',
            hint: 'Could not reach litellm.example.org. Likely causes: the server is not running, the URL is wrong, or it rejects requests from this origin. For LiteLLM set LITELLM_CORS_ORIGINS=https://rucio-ui.cern.ch. For other servers, allow the origin https://rucio-ui.cern.ch.',
        });
    });

    it('hedges an opaque OpenAI failure and mentions the key as one possible cause', async () => {
        const result = await run(openai, failNetwork());
        expect(result).toMatchObject({ ok: false, code: 'network' });
        expect(result.ok === false && result.hint).toContain('API key');
        expect(result.ok === false && result.hint).toContain('Likely causes');
    });

    it('uses relay specific messages for relay 403 and 5xx', async () => {
        await expect(run(operator, respond(403))).resolves.toMatchObject({ ok: false, code: 'auth', hint: expect.stringContaining('Rucio bot') });
        await expect(run(operator, respond(500))).resolves.toEqual({
            ok: false,
            code: 'network',
            hint: 'The server returned HTTP 500. Try again later.',
        });
    });

    it('reports a network problem for Anthropic and the relay', async () => {
        await expect(run(anthropic, failNetwork())).resolves.toMatchObject({ ok: false, code: 'network' });
        await expect(run(operator, failNetwork())).resolves.toMatchObject({ ok: false, code: 'network' });
    });

    it('times out', async () => {
        const hang = jest.fn(
            (_url: string, init: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
                }),
        );
        await expect(run(openai, hang, { timeoutMs: 10 })).resolves.toEqual({
            ok: false,
            code: 'network',
            hint: 'No answer within 1 second. Check the base URL and that the server is running.',
        });
    });

    it('pluralises the timeout for several seconds', async () => {
        const hang = jest.fn(
            (_url: string, init: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
                }),
        );
        jest.useFakeTimers();
        try {
            const pending = run(openai, hang, { timeoutMs: 2000 });
            await jest.advanceTimersByTimeAsync(2000);
            await expect(pending).resolves.toEqual({
                ok: false,
                code: 'network',
                hint: 'No answer within 2 seconds. Check the base URL and that the server is running.',
            });
        } finally {
            jest.useRealTimers();
        }
    });

    it('stops when the caller aborts', async () => {
        const controller = new AbortController();
        const hang = jest.fn(
            (_url: string, init: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
                }),
        );
        const pending = testProviderConnection(openai, controller.signal, {
            origin: 'http://localhost:3000',
            fetchImpl: hang as unknown as typeof fetch,
        });
        controller.abort();
        await expect(pending).resolves.toEqual({ ok: false, code: 'network', hint: 'The connection test was cancelled.' });
    });

    it('never puts the API key in a hint', async () => {
        const result = await run(openai, respond(400, '{"error":{"message":"Incorrect API key provided: sk-openai"}}'));
        expect(result.ok === false && result.hint).not.toContain('sk-openai');
    });
});
