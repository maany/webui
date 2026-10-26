'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { AssistantSettings } from '@/lib/core/entity/assistant/settings';
import {
    ASSISTANT_SESSION_KEYS_KEY,
    ASSISTANT_SETTINGS_KEY,
    clearAssistantSettings,
    getDefaultAssistantSettings,
    loadAssistantSettings,
    saveAssistantSettings,
} from '@/lib/infrastructure/assistant/settings-storage';

const SERVER_SNAPSHOT: AssistantSettings = getDefaultAssistantSettings();
const listeners = new Set<() => void>();
let cachedRaw: string | undefined;
let cachedSettings: AssistantSettings = SERVER_SNAPSHOT;

function readRaw(): string {
    try {
        return `${localStorage.getItem(ASSISTANT_SETTINGS_KEY) ?? ''}\n${sessionStorage.getItem(ASSISTANT_SESSION_KEYS_KEY) ?? ''}`;
    } catch {
        return '';
    }
}

/** Re-parses only when the stored strings change, so the snapshot keeps its identity between renders. */
function getSnapshot(): AssistantSettings {
    const raw = readRaw();
    if (raw !== cachedRaw) {
        cachedRaw = raw;
        cachedSettings = loadAssistantSettings();
    }
    return cachedSettings;
}

function getServerSnapshot(): AssistantSettings {
    return SERVER_SNAPSHOT;
}

function notify(): void {
    listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
        if (event.key === null || event.key === ASSISTANT_SETTINGS_KEY) listener();
    };
    window.addEventListener('storage', onStorage);
    return () => {
        listeners.delete(listener);
        window.removeEventListener('storage', onStorage);
    };
}

/**
 * Rucio bot settings from localStorage (keys from sessionStorage when keyStorage is 'session').
 * Every hook instance in the tab updates together; other tabs follow through the 'storage' event.
 */
export function useAssistantSettings(): {
    settings: AssistantSettings;
    update(patch: (settings: AssistantSettings) => AssistantSettings): void;
    reset(): void;
} {
    const settings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

    const update = useCallback((patch: (settings: AssistantSettings) => AssistantSettings) => {
        saveAssistantSettings(patch(getSnapshot()));
        notify();
    }, []);

    const reset = useCallback(() => {
        clearAssistantSettings();
        notify();
    }, []);

    return { settings, update, reset };
}
