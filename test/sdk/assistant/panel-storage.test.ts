import {
    clampPanelWidth,
    loadPanelWidth,
    panelMaxWidth,
    PANEL_DEFAULT_WIDTH,
    PANEL_MAX_WIDTH,
    PANEL_MIN_WIDTH,
    savePanelWidth,
} from '@/lib/infrastructure/assistant/panel-storage';

describe('panel width clamp', () => {
    it('caps the width at 45% of the viewport, floored, between the min and max', () => {
        expect(panelMaxWidth(1000)).toBe(450);
        expect(panelMaxWidth(1001)).toBe(450);
        expect(panelMaxWidth(1600)).toBe(PANEL_MAX_WIDTH);
        expect(panelMaxWidth(500)).toBe(PANEL_MIN_WIDTH);
    });

    it('applies the viewport cap on top of the absolute bounds', () => {
        expect(clampPanelWidth(700, 1000)).toBe(450);
        expect(clampPanelWidth(400, 1000)).toBe(400);
        expect(clampPanelWidth(100, 1000)).toBe(PANEL_MIN_WIDTH);
        expect(clampPanelWidth(900)).toBe(PANEL_MAX_WIDTH);
        expect(clampPanelWidth(700, 1440)).toBe(648);
    });

    it('clamps a stored width to the viewport on load and keeps the stored preference', () => {
        localStorage.clear();
        expect(loadPanelWidth(1000)).toBe(PANEL_DEFAULT_WIDTH);
        savePanelWidth(700);
        expect(loadPanelWidth(1000)).toBe(450);
        expect(loadPanelWidth(1800)).toBe(700);
    });
});
