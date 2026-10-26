'use client';

import { usePathname } from 'next/navigation';
import { starterPromptsFor } from '@/lib/infrastructure/assistant/starter-prompts';
import { cn } from '@/component-library/utils';

export interface StarterPromptsProps {
    onSelect: (prompt: string) => void;
    disabled?: boolean;
}

/** Suggestions for the current page, shown while the conversation is empty. */
export const StarterPrompts = ({ onSelect, disabled = false }: StarterPromptsProps) => {
    const pathname = usePathname() ?? '/';
    const prompts = starterPromptsFor(pathname);

    return (
        <div role="group" aria-label="Suggested questions" className="flex flex-col gap-2">
            <p className="text-sm text-neutral-600 dark:text-neutral-400">Try asking</p>
            <ul className="flex flex-col gap-2">
                {prompts.map(prompt => (
                    <li key={prompt}>
                        <button
                            type="button"
                            disabled={disabled}
                            onClick={() => onSelect(prompt)}
                            className={cn(
                                'w-full min-h-11 rounded-md px-3 py-2 text-left text-sm',
                                'border border-neutral-200 dark:border-neutral-700',
                                'bg-neutral-0 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100',
                                'hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors',
                                'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500',
                                'disabled:opacity-50 disabled:pointer-events-none',
                            )}
                        >
                            {prompt}
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
};
