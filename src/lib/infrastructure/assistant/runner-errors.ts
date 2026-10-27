/** `finished.error` value when the prompt no longer fits the model's context window. */
export const CONTEXT_OVERFLOW_ERROR = 'context_overflow';

/** `finished.error` value when the operator relay no longer accepts the user's session. */
export const SESSION_EXPIRED_ERROR = 'session_expired';

/** `finished.error` value when the browser could not save the conversation mid-turn, so the turn was stopped. */
export const TURN_SAVE_FAILED_ERROR = 'turn_save_failed';

const TOO_MANY_STREAMS_TEXT = 'Too many assistant replies are running for this account. Wait for one to finish and try again.';

const SESSION_EXPIRED_TEXT = 'Your session has expired. Log in again.';

/** Short, user-facing hint for a provider error message. */
export function describeRunError(error: string, options: { relay?: boolean } = {}): string {
    if (error === SESSION_EXPIRED_ERROR) return SESSION_EXPIRED_TEXT;
    if (options.relay) {
        if (/\b401\b/.test(error)) return SESSION_EXPIRED_TEXT;
        if (/\b404\b/.test(error)) return 'The assistant is not configured on this server.';
    }
    if (error === TURN_SAVE_FAILED_ERROR)
        return 'Rucio bot could not save this conversation in the browser, so it stopped the turn. Free up browser storage, then press Retry.';
    if (error === CONTEXT_OVERFLOW_ERROR)
        return 'The conversation is too long for this model. Start a new chat or pick a model with a larger context window.';
    if (/too_many_streams/.test(error)) return TOO_MANY_STREAMS_TEXT;
    if (/\b429\b|rate.?limit/i.test(error)) return `The provider is rate limiting requests. Wait a moment, then press Retry. (${error})`;
    if (/\b401\b|invalid.*key|unauthori[sz]ed|authentication/i.test(error))
        return `The provider rejected the API key. Check it in Rucio bot settings. (${error})`;
    if (/failed to fetch|network|cors|load failed/i.test(error))
        return `Rucio bot could not reach the provider. Check the base URL, CORS settings and that the server is running, then use Test connection in settings. (${error})`;
    if (/\b404\b|model.*not.*found/i.test(error)) return `The provider does not know this model. Check the model name in settings. (${error})`;
    return error;
}
