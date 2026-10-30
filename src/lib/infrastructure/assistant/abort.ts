/** An AbortError that works in browsers, jsdom and Node. */
export function abortError(): Error {
    return new DOMException('The operation was aborted.', 'AbortError') as unknown as Error;
}

export function isAbortError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

const MAX_MESSAGE_LENGTH = 1000;

export function errorMessage(error: unknown): string {
    let message: string;
    if (error instanceof Error) message = error.message;
    else if (typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string') {
        message = (error as { message: string }).message;
    } else message = String(error);
    return message.slice(0, MAX_MESSAGE_LENGTH);
}
