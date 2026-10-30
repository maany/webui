import { chat } from '@tanstack/ai';
import { fakeText } from '@tanstack/ai/testing';
import { ChatClient } from '@tanstack/ai-client';
import { openDB } from 'idb';

describe('phase 1b dependencies', () => {
    it('loads TanStack AI, the chat client and idb under Jest', async () => {
        const fake = fakeText();
        fake.setResponses([{ text: 'pong' }]);
        let text = '';
        for await (const chunk of chat({ adapter: fake, messages: [{ role: 'user', content: 'ping' }], threadId: 'smoke' })) {
            if (chunk.type === 'TEXT_MESSAGE_CONTENT') text += chunk.delta;
        }
        expect(text).toBe('pong');
        expect(typeof ChatClient).toBe('function');
        expect(typeof openDB).toBe('function');
    });
});
