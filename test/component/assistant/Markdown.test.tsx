jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ href, children, prefetch, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => (
        <a href={href} data-next-link="true" data-prefetch={String(prefetch)} {...rest}>
            {children}
        </a>
    ),
}));

import React from 'react';
import { render, screen } from '@testing-library/react';
import { Markdown, isInAppHref } from '@/component-library/features/assistant/Markdown';

describe('Markdown', () => {
    it('renders reference-style images as alt text plus a click-only link', () => {
        const { container } = render(<Markdown text={'![the ref][r]\n\n[r]: https://evil.example/p?d=secret'} />);
        expect(container.querySelector('img')).toBeNull();
        expect(screen.getByText('the ref').closest('a')).toHaveAttribute('href', 'https://evil.example/p?d=secret');
    });

    it('does not nest anchors for linked images', () => {
        const { container } = render(<Markdown text={'[![inner alt](https://evil.example/a.png)](https://example.org/target)'} />);
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelectorAll('a a')).toHaveLength(0);
        expect(container.querySelectorAll('a')).toHaveLength(1);
        expect(screen.getByText('inner alt').closest('a')).toHaveAttribute('href', 'https://example.org/target');
    });

    it('does not prefetch in-app links', () => {
        render(<Markdown text={'[rule](/rule/abc)'} />);
        expect(screen.getByText('rule').closest('a')).toHaveAttribute('data-prefetch', 'false');
    });

    it('never renders an img element for markdown images, only alt text and a click-only link', () => {
        const { container } = render(<Markdown text={'![the alt](https://evil.example/p?d=secret) and ![](/local.png)'} />);
        expect(container.querySelector('img')).toBeNull();
        const link = screen.getByText('the alt').closest('a');
        expect(link).toHaveAttribute('href', 'https://evil.example/p?d=secret');
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        expect(container.querySelector('[src]')).toBeNull();
    });

    it('renders GFM tables and strikethrough', () => {
        const { container } = render(<Markdown text={'| state | count |\n|---|---|\n| STUCK | 3 |\n\n~~old~~'} />);
        expect(container.querySelector('table')).not.toBeNull();
        expect(screen.getByText('STUCK')).toBeInTheDocument();
        expect(container.querySelector('del')).not.toBeNull();
    });

    it('never renders raw HTML or javascript links', () => {
        const { container } = render(<Markdown text={'<script>alert(1)</script><img src=x onerror=alert(1)>\n\n[click](javascript:alert(1))'} />);
        expect(container.querySelector('script')).toBeNull();
        expect(container.querySelector('img')).toBeNull();
        expect(screen.getByText('click').getAttribute('href')).toBeNull();
    });

    it('uses client navigation for in-app links and a new tab for external ones', () => {
        render(<Markdown text={'[rule](/rule/abc) and [docs](https://rucio.cern.ch/documentation/)'} />);
        expect(screen.getByText('rule').closest('a')).toHaveAttribute('data-next-link', 'true');
        const external = screen.getByText('docs').closest('a');
        expect(external).toHaveAttribute('target', '_blank');
        expect(external).toHaveAttribute('rel', 'noopener noreferrer');
        expect(isInAppHref('//evil.example')).toBe(false);
    });

    it('only treats single-slash paths without backslashes, whitespace or control characters as in-app', () => {
        expect(isInAppHref('/rules')).toBe(true);
        for (const href of ['//evil.com', '/\\evil.com', '/rules\\x', '/\tevil', '/a b', 'https://x', 'javascript:alert(1)', '', undefined]) {
            expect(isInAppHref(href)).toBe(false);
        }
    });

    it('highlights fenced code', () => {
        const { container } = render(<Markdown text={'```sql\nSELECT 1\n```'} />);
        expect(container.querySelector('code.language-sql, .language-sql')).not.toBeNull();
    });
});
