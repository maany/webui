import { Response as UndiciResponse } from 'undici';

/** What the scripted model answers for one request. */
export type ScriptStep = { toolCall: { id: string; name: string; args: unknown } } | { text: string };

export interface OpenAIRequestMessage {
    role: string;
    content?: unknown;
    tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    tool_call_id?: string;
}

export interface OpenAIRequestBody {
    model: string;
    messages: OpenAIRequestMessage[];
    tools?: Array<{ function?: { name: string } }>;
}

export interface FeatureCall {
    url: string;
    method: string;
    body: unknown;
}

export interface ScriptedWorld {
    modelRequests: OpenAIRequestBody[];
    featureCalls: FeatureCall[];
    fetch: jest.Mock;
}

function sse(step: ScriptStep, model: string): UndiciResponse {
    const base = { id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model };
    const chunks: unknown[] = [];
    if ('toolCall' in step) {
        const { id, name, args } = step.toolCall;
        chunks.push({
            ...base,
            choices: [
                {
                    index: 0,
                    delta: { role: 'assistant', content: null, tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: '' } }] },
                    finish_reason: null,
                },
            ],
        });
        chunks.push({
            ...base,
            choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] }, finish_reason: null }],
        });
        chunks.push({
            ...base,
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });
    } else {
        chunks.push({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: step.text }, finish_reason: null }] });
        chunks.push({
            ...base,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 },
        });
    }
    const body = chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
    return new UndiciResponse(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/**
 * A routed fetch: '<baseURL>/chat/completions' goes to the scripted model, '/api/feature/*' is recorded
 * and answered with JSON. Anything else fails the test. Responses are undici Responses with web streams,
 * because jest-fetch-mock replaces the global Response with one whose body is a Node stream.
 */
export function createScriptedWorld(
    script: (body: OpenAIRequestBody, index: number) => ScriptStep,
    featureResponse: (call: FeatureCall) => { status: number; json: unknown } = () => ({
        status: 200,
        json: { status: 'success', rule_ids: ['r-new'] },
    }),
): ScriptedWorld {
    const world: ScriptedWorld = { modelRequests: [], featureCalls: [], fetch: jest.fn() };
    world.fetch.mockImplementation(async (input: string | URL | { url: string }, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith('/chat/completions')) {
            const body = JSON.parse(String(init?.body ?? '{}')) as OpenAIRequestBody;
            world.modelRequests.push(body);
            return sse(script(body, world.modelRequests.length - 1), body.model);
        }
        if (url.startsWith('/api/feature/')) {
            const call: FeatureCall = { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined };
            world.featureCalls.push(call);
            const answer = featureResponse(call);
            return new UndiciResponse(JSON.stringify(answer.json), { status: answer.status, headers: { 'content-type': 'application/json' } });
        }
        throw new Error(`Unexpected fetch in test: ${url}`);
    });
    return world;
}
