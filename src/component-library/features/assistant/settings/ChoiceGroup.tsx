'use client';

import * as React from 'react';
import { cn } from '@/component-library/utils';

export interface ChoiceOption<T extends string> {
    value: T;
    label: string;
    description?: string;
    disabled?: boolean;
}

export interface ChoiceGroupProps<T extends string> {
    name: string;
    legend: string;
    value: T;
    options: ChoiceOption<T>[];
    onChange(value: T): void;
    /** 'row' puts options side by side from md up; 'stack' always stacks them. */
    layout?: 'row' | 'stack';
}

/** Native radio group styled as selectable cards. */
export function ChoiceGroup<T extends string>({ name, legend, value, options, onChange, layout = 'row' }: ChoiceGroupProps<T>) {
    return (
        <fieldset>
            <legend className="mb-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">{legend}</legend>
            <div className={cn('flex flex-col gap-2', layout === 'row' && 'md:flex-row')}>
                {options.map(option => {
                    const id = `${name}-${option.value}`;
                    const checked = option.value === value;
                    return (
                        <label
                            key={option.value}
                            htmlFor={id}
                            className={cn(
                                'flex flex-1 items-start gap-3 rounded-md border px-3 py-2 transition-colors',
                                checked
                                    ? 'border-brand-500 bg-brand-100/50 dark:border-brand-400 dark:bg-brand-900/30'
                                    : 'border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800',
                                option.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                            )}
                        >
                            <input
                                id={id}
                                type="radio"
                                name={name}
                                value={option.value}
                                checked={checked}
                                disabled={option.disabled}
                                onChange={() => onChange(option.value)}
                                className="mt-1 h-4 w-4 accent-brand-600 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500"
                            />
                            <span className="min-w-0">
                                <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-100">{option.label}</span>
                                {option.description && (
                                    <span className="block text-xs text-neutral-600 dark:text-neutral-400">{option.description}</span>
                                )}
                            </span>
                        </label>
                    );
                })}
            </div>
        </fieldset>
    );
}
