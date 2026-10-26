jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
        <a href={href} data-next-link="true" {...rest}>
            {children}
        </a>
    ),
}));

import React from 'react';
import { render, screen } from '@testing-library/react';
import { Markdown, isInAppHref } from '@/component-library/features/assistant/Markdown';

describe('Markdown', () => {
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
