import { z } from 'zod';

const STORAGE_KEY = 'rucio_assistant_panel';
const STORAGE_VERSION = 1;

export const PANEL_MIN_WIDTH = 320;
export const PANEL_MAX_WIDTH = 720;
export const PANEL_DEFAULT_WIDTH = 420;

const PanelStateSchema = z.object({ version: z.literal(STORAGE_VERSION), width: z.number() });

function isBrowser(): boolean {
    return typeof window !== 'undefined';
}

export function clampPanelWidth(width: number, viewportWidth?: number): number {
    const max = viewportWidth ? Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, viewportWidth - 240)) : PANEL_MAX_WIDTH;
    return Math.round(Math.min(max, Math.max(PANEL_MIN_WIDTH, width)));
}

export function loadPanelWidth(): number {
    if (!isBrowser()) return PANEL_DEFAULT_WIDTH;
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return PANEL_DEFAULT_WIDTH;
        const parsed = PanelStateSchema.safeParse(JSON.parse(stored));
        return parsed.success ? clampPanelWidth(parsed.data.width) : PANEL_DEFAULT_WIDTH;
    } catch {
        return PANEL_DEFAULT_WIDTH;
    }
}

export function savePanelWidth(width: number): void {
    if (!isBrowser()) return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, width: clampPanelWidth(width) }));
    } catch (error) {
        console.error('Failed to save assistant panel width:', error);
    }
}
