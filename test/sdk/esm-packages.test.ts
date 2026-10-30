import { chat, toolDefinition } from '@tanstack/ai';

// @tanstack/ai is ESM only and its package.json only exports the "import" condition.
// Loading it proves test/jest.esm.js and test/jest.resolver.js work for every Jest project.
describe('ESM-only packages', () => {
    it('loads @tanstack/ai', () => {
        expect(typeof chat).toBe('function');
        expect(typeof toolDefinition).toBe('function');
    });
});
