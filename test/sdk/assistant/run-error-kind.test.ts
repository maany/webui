import {
    CONTEXT_OVERFLOW_ERROR,
    OFF_TOPIC_ERROR,
    SESSION_EXPIRED_ERROR,
    TURN_SAVE_FAILED_ERROR,
    classifyRunError,
} from '@/lib/infrastructure/assistant/runner-errors';

describe('classifyRunError', () => {
    it.each([
        ['401 Unauthorized: invalid x-api-key', false],
        ['Incorrect API key provided', false],
        ['authentication_error', false],
        ['This provider has no base URL. Add one in Rucio bot settings.', false],
        ['404 model not found: gpt-nope', false],
        ['404 Not Found', true],
    ])('treats %s (relay %s) as a configuration error', (error, relay) => {
        expect(classifyRunError(error, { relay })).toBe('configuration');
    });

    it.each([
        ['Failed to fetch', false],
        ['429 Too Many Requests', false],
        ['too_many_streams', true],
        ['500 Internal Server Error', false],
        ['503 Service Unavailable', true],
        ['The model returned an unexpected response', false],
        [CONTEXT_OVERFLOW_ERROR, false],
        [TURN_SAVE_FAILED_ERROR, false],
        [OFF_TOPIC_ERROR, true],
    ])('keeps Retry for %s (relay %s)', (error, relay) => {
        expect(classifyRunError(error, { relay })).toBe('retryable');
    });

    it('treats an expired session (or a relay 401) as a session error', () => {
        expect(classifyRunError(SESSION_EXPIRED_ERROR)).toBe('session');
        expect(classifyRunError('401 Unauthorized', { relay: true })).toBe('session');
    });
});
