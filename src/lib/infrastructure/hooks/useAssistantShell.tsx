'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useFeature } from '@/component-library/features/feature-flags/FeatureProvider';
import type { AssistantPageActionRegistryPort } from '@/lib/core/port/secondary/assistant-page-action-registry-port';
import { attachPageActionRegistry, useAttachedPageActionRegistry } from '@/lib/infrastructure/assistant/page-action-bridge';
import { createPageActionRegistry } from '@/lib/infrastructure/assistant/page-action-registry';
import { loadAssistantSettings } from '@/lib/infrastructure/assistant/settings-storage';
import { registerSignOutHook } from '@/lib/infrastructure/auth/sign-out-hooks';

export type AssistantPanelState = 'closed' | 'open' | 'minimized';

export interface AssistantMemoryControls {
    memoryBytes(): Promise<number>;
    freeMemory(): Promise<void>;
}

export interface AssistantShellValue {
    /** FEATURE_ASSISTANT is on. Everything else is inert when false. */
    enabled: boolean;
    panelState: AssistantPanelState;
    /** True once the panel was opened; the heavy assistant bundle loads from then on. */
    hasOpened: boolean;
    open(): void;
    close(): void;
    toggle(): void;
    /** Shrinks the mobile sheet to the floating bubble. Does nothing on desktop. */
    minimize(): void;
    registry: AssistantPageActionRegistryPort;
    memoryControls: AssistantMemoryControls | null;
    registerMemoryControls(controls: AssistantMemoryControls): () => void;
    /** Bumped when stored conversations change outside the panel (settings page). */
    storageVersion: number;
    notifyStorageChanged(): void;
}

/** Below the Tailwind `md` breakpoint the panel is a full-screen sheet. */
export const ASSISTANT_MOBILE_QUERY = '(max-width: 767px)';
export const ASSISTANT_SHORTCUT_LABEL = 'Ctrl+Shift+K';

export function isAssistantShortcut(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>): boolean {
    return (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k';
}

function isMobileViewport(): boolean {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(ASSISTANT_MOBILE_QUERY).matches;
}

const noop = () => undefined;

const DISABLED_SHELL: AssistantShellValue = {
    enabled: false,
    panelState: 'closed',
    hasOpened: false,
    open: noop,
    close: noop,
    toggle: noop,
    minimize: noop,
    registry: createPageActionRegistry(),
    memoryControls: null,
    registerMemoryControls: () => noop,
    storageVersion: 0,
    notifyStorageChanged: noop,
};

const AssistantShellContext = createContext<AssistantShellValue | null>(null);

/**
 * Light, always-mounted part of Rucio bot: panel open state, the keyboard
 * shortcut, the page action registry and the clear-on-logout hook. The chat
 * itself (runner, provider SDKs, markdown) loads with next/dynamic only after
 * the panel is opened for the first time.
 */
export function AssistantShellProvider({ children }: { children: ReactNode }) {
    const enabled = useFeature('assistant');
    const [panelState, setPanelState] = useState<AssistantPanelState>('closed');
    const [hasOpened, setHasOpened] = useState(false);
    const [registry] = useState(createPageActionRegistry);
    const [memoryControls, setMemoryControls] = useState<AssistantMemoryControls | null>(null);
    const [storageVersion, setStorageVersion] = useState(0);

    const open = useCallback(() => {
        setHasOpened(true);
        setPanelState('open');
    }, []);
    const close = useCallback(() => setPanelState('closed'), []);
    const toggle = useCallback(() => {
        setHasOpened(true);
        setPanelState(state => (state === 'open' ? 'closed' : 'open'));
    }, []);
    const minimize = useCallback(() => {
        if (isMobileViewport()) setPanelState(state => (state === 'open' ? 'minimized' : state));
    }, []);
    const registerMemoryControls = useCallback((controls: AssistantMemoryControls) => {
        setMemoryControls(controls);
        return () => setMemoryControls(current => (current === controls ? null : current));
    }, []);
    const notifyStorageChanged = useCallback(() => setStorageVersion(version => version + 1), []);

    // Pages reach the registry through the bridge (phase 3), so they never import the assistant bundle.
    useEffect(() => (enabled ? attachPageActionRegistry(registry) : undefined), [enabled, registry]);

    useEffect(() => {
        if (!enabled) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (!isAssistantShortcut(event)) return;
            event.preventDefault();
            toggle();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [enabled, toggle]);

    useEffect(() => {
        if (!enabled) return;
        return registerSignOutHook(async () => {
            if (!loadAssistantSettings().retention.clearOnLogout) return;
            const { deleteAssistantDatabase } = await import('@/lib/infrastructure/assistant/indexeddb-conversation-repository');
            await deleteAssistantDatabase();
        });
    }, [enabled]);

    const value = useMemo<AssistantShellValue>(
        () =>
            enabled
                ? {
                      enabled,
                      panelState,
                      hasOpened,
                      open,
                      close,
                      toggle,
                      minimize,
                      registry,
                      memoryControls,
                      registerMemoryControls,
                      storageVersion,
                      notifyStorageChanged,
                  }
                : DISABLED_SHELL,
        [
            enabled,
            panelState,
            hasOpened,
            open,
            close,
            toggle,
            minimize,
            registry,
            memoryControls,
            registerMemoryControls,
            storageVersion,
            notifyStorageChanged,
        ],
    );

    return <AssistantShellContext.Provider value={value}>{children}</AssistantShellContext.Provider>;
}

/** Panel state and controls. Safe outside the provider: returns an inert, disabled shell. */
export function useAssistantPanel(): AssistantShellValue {
    return useContext(AssistantShellContext) ?? DISABLED_SHELL;
}

/** The page action registry, or null when Rucio bot is disabled. Same instance as the bridge holds. */
export function usePageActionRegistry(): AssistantPageActionRegistryPort | null {
    return useAttachedPageActionRegistry();
}
