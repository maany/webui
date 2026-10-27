/** Sent by the assistant's executors: the `account@vo` that was active when the write was approved or the read started. */
export const ASSISTANT_ACCOUNT_HEADER = 'x-rucio-assistant-account';
export const ACCOUNT_MISMATCH_ERROR_TYPE = 'account_mismatch';
export const ACCOUNT_MISMATCH_MESSAGE = 'The signed-in account changed after this action was approved. Nothing changed.';
export const ACCOUNT_CHANGED_READ_MESSAGE = 'The signed-in account changed after this request started. Ask again to read as the current account.';

/** True when the header is present and names a different account than the session's (`account@vo`, or undefined when missing). */
export function isAccountMismatch(headerValue: string | null | undefined, sessionAccountKey: string | undefined): boolean {
    if (headerValue === null || headerValue === undefined) return false;
    return headerValue !== sessionAccountKey;
}
