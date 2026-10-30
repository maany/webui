import { ALL_STARTER_PROMPTS, starterPromptsFor } from '@/lib/infrastructure/assistant/starter-prompts';

describe('starterPromptsFor', () => {
    it.each([
        ['/dashboard', 'How many of my rules are stuck?'],
        ['/', 'How many of my rules are stuck?'],
        ['/rule/abc123', 'Why is this rule stuck?'],
        ['/rule/create', 'Fill the wizard to replicate a dataset to tier=1'],
        ['/rules', 'Show my stuck rules'],
        ['/rules/approve', 'Summarise the rules waiting for approval'],
        ['/did/user.jdoe/dataset1', 'Where is this DID replicated?'],
        ['/dids', 'Find the datasets in my scope'],
        ['/rse/CERN-PROD', 'Summarise usage and quotas'],
        ['/rses', 'Which RSEs are tape?'],
        ['/subscription/jdoe/sub1', 'Summarise the rules of this subscription'],
        ['/subscriptions', 'Show my subscriptions'],
        ['/account/jdoe', 'Is this account close to its quotas?'],
        ['/accounts', 'Which accounts are over 90% quota?'],
        ['/suspicious-replicas', 'What can you do?'],
    ])('suggests for %s', (pathname, expected) => {
        expect(starterPromptsFor(pathname)).toContain(expected);
    });

    it('keeps every prompt short and free of em dashes', () => {
        ALL_STARTER_PROMPTS.forEach(prompt => {
            expect(prompt).not.toContain('\u2014');
            expect(prompt.length).toBeLessThanOrEqual(60);
        });
    });

    it('offers at most three prompts per page', () => {
        ['/dashboard', '/rule/x', '/did/a/b', '/nothing'].forEach(pathname => expect(starterPromptsFor(pathname).length).toBeLessThanOrEqual(3));
    });
});
