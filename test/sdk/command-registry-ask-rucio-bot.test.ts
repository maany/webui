import { getAssistantCommands } from '@/lib/infrastructure/command-palette/command-registry';

describe('getAssistantCommands', () => {
    it('offers "Ask Rucio bot", which opens the panel', () => {
        const open = jest.fn();
        const [command] = getAssistantCommands(open);
        expect(command).toMatchObject({ id: 'action-ask-rucio-bot', type: 'action', title: 'Ask Rucio bot', shortcut: 'Ctrl+Shift+K' });
        expect(command.keywords).toEqual(expect.arrayContaining(['assistant', 'bot', 'chat', 'ai']));
        command.onSelect?.();
        expect(open).toHaveBeenCalledTimes(1);
    });
});
