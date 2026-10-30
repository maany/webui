import { isInAppHref, isSafeNavigateUrl } from '@/lib/infrastructure/assistant/in-app-href';

describe('isInAppHref', () => {
    it('accepts in-app paths', () => {
        expect(isInAppHref('/rule/1')).toBe(true);
        expect(isInAppHref('/rules')).toBe(true);
    });

    it.each(['//evil', '//evil.example', '/\\evil', 'https://x', '/a b', '/a\u0001b', '/a\tb', '', 'rules'])('rejects %j', href => {
        expect(isInAppHref(href)).toBe(false);
    });

    it('rejects a missing href', () => {
        expect(isInAppHref(undefined)).toBe(false);
    });
});

describe('isSafeNavigateUrl', () => {
    it.each(['/did/user.jdoe/file%201', '/rules?autoSearch=true&state=Stuck', '/rule/create', '/dashboard'])('accepts %s', url => {
        expect(isSafeNavigateUrl(url)).toBe(true);
    });

    it.each(['/did/../auth', '/rule/..', '/auth/login', '/AUTH/login', '/api/feature/x', '//evil.com', 'https://evil.com', '/a b', '/./rules'])(
        'rejects %s',
        url => {
            expect(isSafeNavigateUrl(url)).toBe(false);
        },
    );
});
