export interface FakeResponseInit {
    status?: number;
    type?: ResponseType;
    contentType?: string | null;
    /** Body chunks, delivered one per read(). */
    chunks?: string[];
    /** Error the body stream raises after the last chunk (a dropped connection). */
    failWith?: Error;
    /** After the last chunk the body never yields again (a hung connection). */
    hang?: boolean;
    /** Called when the reader cancels the body. */
    onCancel?: () => void;
}

/** A minimal Response with a real ReadableStream body; node-fetch's Response (used by jest-fetch-mock) has none. */
export function fakeResponse(init: FakeResponseInit = {}): Response {
    const encoder = new TextEncoder();
    const chunks = init.chunks ?? [];
    let index = 0;
    const body = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (index < chunks.length) {
                controller.enqueue(encoder.encode(chunks[index]));
                index += 1;
            } else if (init.hang) {
                return new Promise<void>(() => undefined);
            } else if (init.failWith) {
                controller.error(init.failWith);
            } else {
                controller.close();
            }
        },
        cancel() {
            init.onCancel?.();
        },
    });
    const status = init.status ?? 200;
    const contentType = init.contentType === undefined ? 'application/json' : init.contentType;
    return {
        status,
        ok: status >= 200 && status < 300,
        type: init.type ?? 'basic',
        redirected: false,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
        body,
        text: async () => chunks.join(''),
    } as unknown as Response;
}

export const ndjson = (...rows: unknown[]): string => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
