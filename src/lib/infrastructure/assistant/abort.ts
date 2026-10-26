/** An AbortError that works in browsers, jsdom and Node. */
export function abortError(): Error {
    return new DOMException('The operation was aborted.', 'AbortError') as unknown as Error;
}

export function isAbortError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

export function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string') {
        return (error as { message: string }).message;
    }
    return String(error);
}
