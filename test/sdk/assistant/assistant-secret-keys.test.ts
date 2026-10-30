import { isSecretFieldName, normaliseFieldName } from '@/lib/core/services/assistant-secret-keys';

describe('isSecretFieldName', () => {
    it.each([
        'password',
        'Secret',
        'apiKey',
        'api_key',
        'jwt',
        'bearer',
        'authorization',
        'cookie',
        'session',
        'sessionId',
        'session_id',
        'auth',
        'clientSecret',
        'access_token',
        'X-Rucio-Auth-Token',
        'rucioAuthToken',
        'rucioAuthTokenExpires',
        'db_password',
        'x-api-key',
        'ｐａｓｓｗｏｒｄ',
        'pass​word',
    ])('treats %s as secret', name => {
        expect(isSecretFieldName(name)).toBe(true);
    });

    it.each(['key', 'code', 'value', 'name', 'account', 'state', 'tokens_total', 'rse_expression'])('keeps %s', name => {
        expect(isSecretFieldName(name)).toBe(false);
    });
});

describe('normaliseFieldName', () => {
    it('lowercases and strips separators and format characters', () => {
        expect(normaliseFieldName('X-Rucio_Auth\u200BToken')).toBe('xrucioauthtoken');
    });
});
