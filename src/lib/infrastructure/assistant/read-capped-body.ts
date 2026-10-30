/**
 * Reads the request body up to maxBytes. Returns undefined as soon as the total exceeds the cap
 * (the reader is cancelled), so a chunked body without content-length cannot be buffered unbounded.
 * Bodies that are not web streams are read whole and size-checked afterwards.
 */
export async function readCappedBody(request: Request, maxBytes: number): Promise<Uint8Array | undefined> {
    if (!request.body) {
        return new Uint8Array(0);
    }
    if (typeof request.body.getReader !== 'function') {
        // A runtime whose body is not a web stream (jsdom test polyfill): the body is already buffered, so check its size after the fact.
        const buffered = new Uint8Array(await request.arrayBuffer());
        return buffered.byteLength > maxBytes ? undefined : buffered;
    }
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel().catch(() => undefined);
                return undefined;
            }
            chunks.push(value);
        }
    } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return body;
}

/**
 * Parses a content-length header. Returns undefined when absent, null when present but not a plain
 * non-negative integer (NaN, negative, fractional), otherwise the declared byte count.
 */
export function parseContentLength(value: string | null): number | undefined | null {
    if (value === null) return undefined;
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    return Number(trimmed);
}
