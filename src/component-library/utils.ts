import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { BaseViewModel } from '@/lib/sdk/view-models';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

// Function to emulate pausing between interactions
export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** True on macOS. Browser only: false during server rendering. */
export function isMacPlatform(): boolean {
    if (typeof navigator === 'undefined') return false;
    return navigator.platform.toUpperCase().indexOf('MAC') >= 0 || navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;
}
