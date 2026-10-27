/** Sent by the assistant's write executor: the `account@vo` that was active when the write was approved. */
export const ASSISTANT_ACCOUNT_HEADER = 'x-rucio-assistant-account';
export const ACCOUNT_MISMATCH_ERROR_TYPE = 'account_mismatch';
export const ACCOUNT_MISMATCH_MESSAGE = 'The signed-in account changed after this action was approved. Nothing changed.';

/** True when the header is present and names a different account than the session's (`account@vo`, or undefined when missing). */
export function isAccountMismatch(headerValue: string | null | undefined, sessionAccountKey: string | undefined): boolean {
    if (headerValue === null || headerValue === undefined) return false;
    return headerValue !== sessionAccountKey;
}
