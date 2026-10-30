import { z } from 'zod';
import { createAssistantEventBus } from '@/lib/infrastructure/assistant/event-bus';
import { allTools, getTool, registerTools, resetToolRegistryForTests } from '@/lib/infrastructure/assistant/tool-registry';
import { makeTool } from 'test/fixtures/assistant-fixtures';

describe('createAssistantEventBus', () => {
    it('delivers events to subscribers until they unsubscribe', () => {
        const bus = createAssistantEventBus();
        const seen: string[] = [];
        const unsubscribe = bus.subscribe(event => seen.push(event.type));
        bus.emit({ type: 'compaction', conversationId: 'c', upToMessageId: 'm', at: 1 });
        unsubscribe();
        bus.emit({ type: 'compaction', conversationId: 'c', upToMessageId: 'm', at: 2 });
        expect(seen).toEqual(['compaction']);
    });

    it('keeps delivering when one listener throws', () => {
        const bus = createAssistantEventBus();
        const seen: number[] = [];
        const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        bus.subscribe(() => {
            throw new Error('broken listener');
        });
        bus.subscribe(event => seen.push(event.at));
        bus.emit({ type: 'compaction', conversationId: 'c', upToMessageId: 'm', at: 7 });
        expect(seen).toEqual([7]);
        spy.mockRestore();
    });
});

describe('tool registry', () => {
    beforeEach(() => resetToolRegistryForTests());

    it('starts empty in phase 1b', () => {
        expect(allTools()).toEqual([]);
    });

    it('registers, lists and finds tools; a later registration replaces one with the same name', () => {
        const first = makeTool('list_rules', 'read', z.object({}), async () => ({ v: 1 }));
        const second = makeTool('list_rules', 'read', z.object({}), async () => ({ v: 2 }));
        registerTools([first]);
        registerTools([second]);
        expect(allTools()).toHaveLength(1);
        expect(getTool('list_rules')).toBe(second);
        expect(getTool('missing')).toBeUndefined();
    });
});
