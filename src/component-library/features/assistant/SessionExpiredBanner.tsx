'use client';

import React from 'react';
import Link from 'next/link';
import type { ChatMessage } from '@/lib/core/entity/assistant/conversation';
import { hasSessionExpired } from '@/lib/infrastructure/assistant/message-selectors';

const SAFE_PATH = /^\/(?![/\\])/;

export interface SessionExpiredBannerProps {
    messages: ChatMessage[];
    pathname: string;
    /** Show the banner even when no tool call failed, for example when the controller reports an expired session. */
    forced?: boolean;
}

/** Shown in the panel, directly above the composer, when the WebUI session is gone. */
export const SessionExpiredBanner = ({ messages, pathname, forced = false }: SessionExpiredBannerProps) => {
    if (!forced && !hasSessionExpired(messages)) return null;
    // Only a same-origin path may become the callback; anything else lands on the home page.
    const callback = SAFE_PATH.test(pathname) ? pathname : '/';
    const href = `/auth/login?expired=true&callbackUrl=${encodeURIComponent(callback)}`;
    return (
        <div
            role="alert"
            className="mx-3 mb-2 rounded border border-base-warning-600 bg-base-warning-100 px-3 py-2 text-sm text-base-warning-900 dark:bg-base-warning-900 dark:text-base-warning-100"
        >
            Your session has expired.{' '}
            <Link href={href} className="font-medium underline">
                Log in again
            </Link>{' '}
            to continue.
        </div>
    );
};
