import { appendQueryParams, safeCallbackPath } from '@/lib/infrastructure/utils/safe-callback-url';

describe('appendQueryParams', () => {
    it('adds a query string to a path without one', () => {
        expect(appendQueryParams('/dashboard', new URLSearchParams({ vo: 'def' }))).toBe('/dashboard?vo=def');
    });

    it('keeps existing query params and uses a single "?"', () => {
        const out = appendQueryParams('/did/page?scope=x', new URLSearchParams({ vo: 'def', account: 'root' }));
        expect(out).toBe('/did/page?scope=x&vo=def&account=root');
        expect(out.split('?').length).toBe(2);
    });

    it('keeps the hash after the query', () => {
        expect(appendQueryParams('/p?a=1#frag', new URLSearchParams({ vo: 'def' }))).toBe('/p?a=1&vo=def#frag');
        expect(appendQueryParams('/p#frag', new URLSearchParams({ vo: 'def' }))).toBe('/p?vo=def#frag');
    });

    it('lets the appended params win over an existing key', () => {
        expect(appendQueryParams('/p?vo=old&a=1', new URLSearchParams({ vo: 'new' }))).toBe('/p?a=1&vo=new');
    });

    it('returns the path unchanged when there are no params', () => {
        expect(appendQueryParams('/p?a=1', new URLSearchParams())).toBe('/p?a=1');
    });

    it.each(['//evil.example', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)'])(
        'cannot become off-origin after safeCallbackPath: %s',
        raw => {
            const out = appendQueryParams(safeCallbackPath(raw), new URLSearchParams({ vo: 'def' }));
            expect(out).toBe('/?vo=def');
        },
    );

    it('never returns an absolute or protocol-relative result even for unsanitised input', () => {
        const out = appendQueryParams('//evil.example/x', new URLSearchParams({ vo: 'def' }));
        expect(out.startsWith('/')).toBe(true);
        expect(out.startsWith('//')).toBe(false);
    });
});
