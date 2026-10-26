import { isSecretFieldName } from '@/lib/core/services/assistant-secret-keys';

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
