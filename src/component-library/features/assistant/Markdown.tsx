'use client';

import React from 'react';
import Link from 'next/link';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import Highlight from 'react-highlight';
import { cn } from '@/component-library/utils';
import { isInAppHref } from '@/lib/infrastructure/assistant/in-app-href';

export { isInAppHref };

/**
 * Model output must never make the browser fetch anything on render, so
 * markdown images become plain links (alt text, click to open) and img is not
 * an allowed element.
 */
interface MdNode {
    type: string;
    url?: string;
    alt?: string | null;
    identifier?: string;
    children?: MdNode[];
    [key: string]: unknown;
}

function collectDefinitions(node: MdNode, into: Map<string, string>): void {
    if (node.type === 'definition' && node.identifier && node.url) into.set(node.identifier, node.url);
    node.children?.forEach(child => collectDefinitions(child, into));
}

function imagesToLinks(node: MdNode, definitions: Map<string, string>, insideLink: boolean): void {
    if (!node.children) return;
    const inLink = insideLink || node.type === 'link' || node.type === 'linkReference';
    node.children = node.children.map(child => {
        if (child.type === 'image' || child.type === 'imageReference') {
            const url = child.type === 'image' ? child.url : child.identifier ? definitions.get(child.identifier) : undefined;
            const label = child.alt || url || 'image';
            // Never nest an anchor inside an anchor: inside a link the image is just its alt text.
            if (inLink || !url) return { type: 'text', value: label } as MdNode;
            return { type: 'link', url, children: [{ type: 'text', value: label }] } as MdNode;
        }
        imagesToLinks(child, definitions, inLink);
        return child;
    });
}

function remarkImagesToLinks() {
    return (tree: MdNode) => {
        const definitions = new Map<string, string>();
        collectDefinitions(tree, definitions);
        imagesToLinks(tree, definitions, false);
    };
}

const sanitizeSchema = { ...defaultSchema, tagNames: (defaultSchema.tagNames ?? []).filter(tag => tag !== 'img') };

const components: Components = {
    a({ href, children }) {
        if (isInAppHref(href)) {
            return (
                <Link href={href} prefetch={false} className="text-brand-600 dark:text-brand-400 underline">
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
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkImagesToLinks]}
                rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
                components={components}
            >
                {text}
            </ReactMarkdown>
        </div>
    );
}
