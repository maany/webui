import { buildSystemPrompt } from '@/lib/infrastructure/assistant/system-prompt';
import { ASSISTANT_DATA_TOOLS_PROMPT } from '@/lib/infrastructure/assistant/tools/prompt';

const EM_DASH = String.fromCharCode(0x2014);

describe('tool guidance in the system prompt', () => {
    const prompt = buildSystemPrompt({ toolNames: ['find_tools', 'navigate'], now: new Date('2026-10-27T12:00:00Z') });

    it('forbids placeholder, example or made-up identifiers', () => {
        expect(prompt).toMatch(/never call a tool with placeholder, example or made-up identifiers/i);
        expect(prompt).toMatch(/dummy/);
    });

    it('tells the model not to repeat a failed call', () => {
        expect(prompt).toMatch(/do not repeat a call that failed/i);
    });

    it('names the two ways to create a rule and what to do when neither is available', () => {
        expect(prompt).toContain('create_rule');
        expect(prompt).toContain('rule_create');
        expect(prompt).toContain('rule_create.prefill');
        expect(prompt).toMatch(/if neither is available, say so/i);
    });

    it('tells the model to report unavailable tools from find_tools', () => {
        expect(ASSISTANT_DATA_TOOLS_PROMPT).toMatch(/unavailable/);
        expect(ASSISTANT_DATA_TOOLS_PROMPT).toMatch(/tell the user/i);
    });

    it('uses no em dashes', () => {
        expect(prompt).not.toContain(EM_DASH);
        expect(ASSISTANT_DATA_TOOLS_PROMPT).not.toContain(EM_DASH);
    });
});
