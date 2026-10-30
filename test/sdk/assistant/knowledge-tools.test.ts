import { allTools, getTool } from '@/lib/infrastructure/assistant/tool-registry';
import { registerKnowledgeTools } from '@/lib/infrastructure/assistant/tools/knowledge';

describe('registerKnowledgeTools', () => {
    it('registers search_docs and activate_skill once, as always-on core tools', () => {
        registerKnowledgeTools();
        const count = allTools().length;
        registerKnowledgeTools();
        expect(allTools()).toHaveLength(count);
        for (const name of ['search_docs', 'activate_skill']) {
            expect(getTool(name)?.spec).toMatchObject({ name, domain: 'core', risk: 'read', alwaysOn: true });
        }
        expect(getTool('search_docs')?.spec.executor).toBe('docs');
        expect(getTool('activate_skill')?.spec.executor).toBe('skill');
    });
});
