import { getNavigationCommands } from '@/lib/infrastructure/command-palette/command-registry';

const ids = (items: { id: string }[]) => items.map(item => item.id);

describe('command registry Rucio bot entry', () => {
    it('adds the settings entry only when the assistant flag is on', () => {
        expect(ids(getNavigationCommands('jdoe', false, false, false, true))).toContain('nav-assistant-settings');
        expect(ids(getNavigationCommands('jdoe', false, false, false, false))).not.toContain('nav-assistant-settings');
        expect(ids(getNavigationCommands('jdoe'))).not.toContain('nav-assistant-settings');
    });

    it('points at the settings page', () => {
        const entry = getNavigationCommands(undefined, false, false, false, true).find(item => item.id === 'nav-assistant-settings');
        expect(entry?.url).toBe('/assistant/settings');
        expect(entry?.title).toBe('Rucio bot settings');
        expect(entry?.keywords).toEqual(expect.arrayContaining(['assistant', 'bot', 'ai']));
    });
});
