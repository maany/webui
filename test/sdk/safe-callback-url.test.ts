import { safeCallbackPath } from '@/lib/infrastructure/utils/safe-callback-url';

describe('safeCallbackPath', () => {
    it.each([
        ['/dashboard', '/dashboard'],
        ['/did/page?x=1', '/did/page?x=1'],
        ['%2Fdid%2Fpage%3Fx%3D1', '/did/page?x=1'],
    ])('accepts %s', (raw, expected) => {
        expect(safeCallbackPath(raw)).toBe(expected);
    });

    it.each([
        ['absolute url', 'https://evil.example'],
        ['protocol-relative', '//evil.example'],
        ['backslash', '/\\evil.example'],
        ['javascript scheme', 'javascript:alert(1)'],
        ['encoded absolute url', 'https%3A%2F%2Fevil.example'],
        ['encoded protocol-relative', '%2F%2Fevil.example'],
        ['empty', ''],
        ['null', null],
        ['undefined', undefined],
        ['malformed percent-encoding', '%E0%A4%A'],
    ])('falls back to / for %s', (_name, raw) => {
        expect(safeCallbackPath(raw as string | null | undefined)).toBe('/');
    });
});
