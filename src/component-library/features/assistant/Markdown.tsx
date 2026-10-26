'use client';

import React from 'react';
import Link from 'next/link';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import Highlight from 'react-highlight';
import { cn } from '@/component-library/utils';

/** Relative links ("/rule/123") stay in the app; everything else opens in a new tab. */
export function isInAppHref(href: string | undefined): href is string {
    if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//')) return false;
    // Browsers normalise '/\\evil.com' to '//evil.com', so reject backslashes, whitespace and control characters too.
    for (const char of href) {
        const code = char.charCodeAt(0);
        if (char === '\\' || code <= 0x20 || code === 0x7f || /\s/.test(char)) return false;
    }
    return true;
}

const components: Components = {
    a({ href, children }) {
        if (isInAppHref(href)) {
            return (
                <Link href={href} className="text-brand-600 dark:text-brand-400 underline">
                    {children}
                </Link>
            );
        }
        return (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand-600 dark:text-brand-400 underline">
                {children}
            </a>
        );
    },
    code({ className, children }) {
        const language = /language-([\w-]+)/.exec(className ?? '')?.[1];
        const text = String(children).replace(/\n$/, '');
        if (!language && !text.includes('\n')) {
            return <code className="rounded bg-neutral-200 dark:bg-neutral-800 px-1 py-0.5 text-[0.9em] font-mono">{children}</code>;
        }
        return <Highlight className={`language-${language ?? 'plaintext'} text-sm`}>{text}</Highlight>;
    },
    pre({ children }) {
        return <div className="my-2 overflow-x-auto rounded border border-neutral-200 dark:border-neutral-700">{children}</div>;
    },
    table({ children }) {
        return (
            <div className="my-2 overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">{children}</table>
            </div>
        );
    },
    th({ children }) {
        return <th className="border border-neutral-200 dark:border-neutral-700 px-2 py-1 text-left font-semibold">{children}</th>;
    },
    td({ children }) {
        return <td className="border border-neutral-200 dark:border-neutral-700 px-2 py-1 align-top">{children}</td>;
    },
};

/**
 * Model output as Markdown (GFM). Raw HTML is never rendered and links,
 * images and attributes go through rehype-sanitize.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
    return (
        <div className={cn('text-sm leading-relaxed space-y-2 break-words [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5', className)}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components}>
                {text}
            </ReactMarkdown>
        </div>
    );
}
