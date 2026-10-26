import { NextRequest } from 'next/server';

// jsdom doesn't ship Response.json, which NextResponse.json relies on.
if (typeof (global.Response as { json?: unknown }).json !== 'function') {
    (global.Response as unknown as { json: (data: unknown, init?: ResponseInit) => Response }).json = function jsonPolyfill(
        data: unknown,
        init?: ResponseInit,
    ): Response {
        return new Response(JSON.stringify(data), { ...init, headers: { 'content-type': 'application/json' } });
    };
}

import { auth } from '@/lib/infrastructure/auth/auth';
import { GET } from '@/app/api/feature/get-assistant-config/route';
import { ASSISTANT_ENV_KEYS } from '@/lib/infrastructure/gateway/assistant-config-gateway';

// `@/lib/infrastructure/auth/auth` is mapped to test/__mocks__/auth.js; its `auth` mock drives the real session helpers.
const authMock = auth as unknown as jest.Mock;
const signIn = () =>
    authMock.mockResolvedValue({
        user: {
            rucioIdentity: 'jdoe',
            rucioAccount: 'jdoe',
            rucioVO: 'def',
            role: 'user',
            isLoggedIn: true,
            rucioAuthToken: 'rucio-secret-token',
            rucioAuthTokenExpires: '2099-01-01T00:00:00Z',
        },
        allUsers: [],
    });

const req = () => new NextRequest('http://localhost/api/feature/get-assistant-config');

describe('GET /api/feature/get-assistant-config', () => {
    afterEach(() => {
        delete process.env.FEATURE_ASSISTANT;
        delete process.env.FEATURE_ASSISTANT_WRITE;
        ASSISTANT_ENV_KEYS.forEach(key => {
            delete process.env[key];
        });
        authMock.mockResolvedValue(null);
    });

    it('returns 404 while the assistant flag is off (default)', async () => {
        signIn();
        const res = await GET(req());
        expect(res.status).toBe(404);
        await expect(res.json()).resolves.toEqual({ error: 'Not found' });
    });

    it('returns 404 when only a child flag is on', async () => {
        signIn();
        process.env.FEATURE_ASSISTANT_WRITE = 'true';
        expect((await GET(req())).status).toBe(404);
    });

    it('returns 401 without a session', async () => {
        process.env.FEATURE_ASSISTANT = 'true';
        expect((await GET(req())).status).toBe(401);
    });

    it('returns the default config', async () => {
        process.env.FEATURE_ASSISTANT = 'true';
        signIn();
        const res = await GET(req());
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({
            status: 'success',
            writePolicyCap: 'ask',
            highRiskPolicyCap: 'ask',
            allowByok: true,
            allowedProviderKinds: ['anthropic', 'openai', 'openai-compatible', 'ollama'],
            telemetry: { operatorSink: false, allowUserSinks: true, contentCap: 'metadata', hashUser: false },
            operatorSkills: [],
        });
    });

    it('describes the operator default and never returns secrets', async () => {
        process.env.FEATURE_ASSISTANT = 'true';
        process.env.ASSISTANT_DEFAULT_BASE_URL = 'https://llm.internal.example.org/v1';
        process.env.ASSISTANT_DEFAULT_MODEL = 'gpt-oss-120b';
        process.env.ASSISTANT_DEFAULT_MODEL_LABEL = 'CERN GPT-OSS';
        process.env.ASSISTANT_DEFAULT_API_KEY = 'sk-operator-secret';
        process.env.ASSISTANT_TELEMETRY_OTLP_ENDPOINT = 'https://otel.example.org/v1/traces';
        process.env.ASSISTANT_TELEMETRY_OTLP_HEADERS = 'Authorization=Basic c2VjcmV0';
        process.env.ASSISTANT_TELEMETRY_HASH_USER = 'true';
        process.env.ASSISTANT_TELEMETRY_USER_SALT = 'salt-0123456789abcdef';
        process.env.ASSISTANT_WRITE_POLICY_CAP = 'deny';
        signIn();
        const res = await GET(req());
        const text = await res.text();
        expect(res.status).toBe(200);
        expect(JSON.parse(text)).toMatchObject({
            writePolicyCap: 'deny',
            defaultProvider: { kind: 'openai-compatible', model: 'gpt-oss-120b', label: 'CERN GPT-OSS' },
            telemetry: { operatorSink: true, hashUser: true },
        });
        ['sk-operator-secret', 'c2VjcmV0', 'llm.internal.example.org', 'otel.example.org', 'salt-0123456789abcdef', 'rucio-secret-token'].forEach(
            secret => expect(text).not.toContain(secret),
        );
    });
});
