interface FakeResponseInit {
    status?: number;
    contentType?: string;
    redirected?: boolean;
}

function fakeResponse(body: string, init: FakeResponseInit): Response {
    const status = init.status ?? 200;
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: '',
        redirected: init.redirected ?? false,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? init.contentType ?? null : null) },
        text: async () => body,
        json: async () => JSON.parse(body),
    } as unknown as Response;
}

/** A streamed reply as the /api/feature list routes send it: one JSON object per line. */
export function ndjsonResponse(rows: unknown[], init: FakeResponseInit = {}): Response {
    return fakeResponse(rows.map(row => JSON.stringify(row)).join('\n'), { contentType: 'application/x-ndjson', ...init });
}

/** What fetch ends with after following the proxy's login redirect. */
export function loginPageResponse(): Response {
    return fakeResponse('<!doctype html><html><body>Login</body></html>', { contentType: 'text/html; charset=utf-8', redirected: true });
}
