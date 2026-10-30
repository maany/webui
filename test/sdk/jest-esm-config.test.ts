/* eslint-disable @typescript-eslint/no-require-imports */
type JestConfigLike = { transformIgnorePatterns: string[]; resolver?: string };
type ResolverOptions = { conditions?: string[]; defaultResolver: (request: string, options: ResolverOptions) => string };

const { ESM_PACKAGES, withEsmPackages } = require('../jest.esm') as {
    ESM_PACKAGES: string[];
    withEsmPackages: (createConfig: () => Promise<JestConfigLike>) => () => Promise<JestConfigLike>;
};
const resolver = require('../jest.resolver') as (request: string, options: ResolverOptions) => string;

// The shape next/jest 16.4 returns: a node_modules pattern with an allow list, the same for pnpm layouts, then the CSS modules pattern.
const NEXT_JEST_PATTERNS = [
    '/node_modules/(?!.pnpm)(?!(geist|next/dist/client|next/dist/shared/lib|next/src/client|next/src/shared/lib)/)',
    '/node_modules[\\\\/]\\.pnpm[\\\\/](?!(geist|next\\+dist\\+client|next\\+dist\\+shared\\+lib|next\\+src\\+client|next\\+src\\+shared\\+lib)@)(?!.*node_modules[\\\\/](geist|next[\\\\/]dist[\\\\/]client|next[\\\\/]dist[\\\\/]shared[\\\\/]lib|next[\\\\/]src[\\\\/]client|next[\\\\/]src[\\\\/]shared[\\\\/]lib)[\\\\/])',
    '^.+\\.module\\.(css|sass|scss)$',
];

describe('withEsmPackages', () => {
    const load = async () => withEsmPackages(async () => ({ transformIgnorePatterns: [...NEXT_JEST_PATTERNS] }))();
    const isIgnored = (patterns: string[], file: string) => patterns.some(pattern => new RegExp(pattern).test(file));

    it.each([
        '/repo/node_modules/@tanstack/ai/dist/esm/index.js',
        '/repo/node_modules/@tanstack/ai-react/dist/esm/index.js',
        '/repo/node_modules/@tanstack/openai-base/dist/esm/index.js',
        '/repo/node_modules/react-markdown/index.js',
        '/repo/node_modules/micromark-util-symbol/lib/codes.js',
        '/repo/node_modules/permix/dist/core/index.mjs',
        '/repo/node_modules/geist/dist/font.js',
    ])('lets SWC transform %s', async file => {
        expect(isIgnored((await load()).transformIgnorePatterns, file)).toBe(false);
    });

    it.each(['/repo/node_modules/react/index.js', '/repo/node_modules/@tanstack/react-query/build/modern/index.js', '/repo/src/styles/a.module.css'])(
        'still skips %s',
        async file => {
            expect(isIgnored((await load()).transformIgnorePatterns, file)).toBe(true);
        },
    );

    it('keeps the CSS modules pattern and installs the resolver', async () => {
        const config = await load();
        expect(config.transformIgnorePatterns).toHaveLength(NEXT_JEST_PATTERNS.length);
        expect(config.transformIgnorePatterns[NEXT_JEST_PATTERNS.length - 1]).toBe(NEXT_JEST_PATTERNS[NEXT_JEST_PATTERNS.length - 1]);
        expect(config.resolver).toMatch(/jest\.resolver\.js$/);
    });

    it('lists the TanStack AI packages', () => {
        expect(ESM_PACKAGES).toContain('@tanstack/ai[^/]*');
    });
});

describe('jest.resolver', () => {
    it('uses the default resolution when it succeeds', () => {
        const defaultResolver = jest.fn(() => '/repo/node_modules/react/index.js');
        expect(resolver('react', { conditions: ['require', 'default'], defaultResolver })).toBe('/repo/node_modules/react/index.js');
        expect(defaultResolver).toHaveBeenCalledTimes(1);
    });

    it('retries with the import condition for packages that only export import', () => {
        const defaultResolver = jest.fn((request: string, options: ResolverOptions) => {
            if (!options.conditions?.includes('import')) throw new Error(`Cannot find module '${request}'`);
            return '/repo/node_modules/@tanstack/ai/dist/esm/index.js';
        });
        expect(resolver('@tanstack/ai', { conditions: ['require', 'default', 'browser'], defaultResolver })).toBe(
            '/repo/node_modules/@tanstack/ai/dist/esm/index.js',
        );
        expect(defaultResolver).toHaveBeenLastCalledWith(
            '@tanstack/ai',
            expect.objectContaining({ conditions: ['require', 'default', 'browser', 'import'] }),
        );
    });

    it('rethrows when the module is missing under every condition', () => {
        const defaultResolver = jest.fn(() => {
            throw new Error("Cannot find module 'nope'");
        });
        expect(() => resolver('nope', { conditions: ['require', 'default'], defaultResolver })).toThrow("Cannot find module 'nope'");
        expect(defaultResolver).toHaveBeenCalledTimes(2);
    });
});
