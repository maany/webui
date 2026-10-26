'use client';

import { useEffect, useState } from 'react';

/**
 * Height in px hidden by the on-screen keyboard (window height minus the
 * visual viewport), so the mobile composer can stay above it. 0 when the
 * browser has no visualViewport or the hook is disabled.
 */
export function useVisualViewportInset(enabled: boolean): number {
    const [inset, setInset] = useState(0);
    useEffect(() => {
        const viewport = typeof window !== 'undefined' ? window.visualViewport : null;
        if (!enabled || !viewport) {
            setInset(0);
            return;
        }
        const update = () => setInset(Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)));
        update();
        viewport.addEventListener('resize', update);
        viewport.addEventListener('scroll', update);
        return () => {
            viewport.removeEventListener('resize', update);
            viewport.removeEventListener('scroll', update);
        };
    }, [enabled]);
    return inset;
}
