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

/** Widest the docked panel may be: 45% of the viewport, within the absolute bounds. */
export function panelMaxWidth(viewportWidth?: number): number {
    if (!viewportWidth) return PANEL_MAX_WIDTH;
    return Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, Math.floor(0.45 * viewportWidth)));
}

export function clampPanelWidth(width: number, viewportWidth?: number): number {
    return Math.round(Math.min(panelMaxWidth(viewportWidth), Math.max(PANEL_MIN_WIDTH, width)));
}

/** The stored width, clamped to the viewport when one is given. */
export function loadPanelWidth(viewportWidth?: number): number {
    if (!isBrowser()) return PANEL_DEFAULT_WIDTH;
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return clampPanelWidth(PANEL_DEFAULT_WIDTH, viewportWidth);
        const parsed = PanelStateSchema.safeParse(JSON.parse(stored));
        return clampPanelWidth(parsed.success ? parsed.data.width : PANEL_DEFAULT_WIDTH, viewportWidth);
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
