interface StarterPromptRule {
    pattern: RegExp;
    prompts: string[];
}

// First match wins, so more specific paths come first.
const RULES: StarterPromptRule[] = [
    { pattern: /^\/rule\/create\/?$/, prompts: ['Fill the wizard to replicate a dataset to tier=1', 'Explain the options of this wizard'] },
    { pattern: /^\/rules\/approve\/?$/, prompts: ['Summarise the rules waiting for approval'] },
    { pattern: /^\/rule\/[^/]+\/?$/, prompts: ['Why is this rule stuck?', 'Summarise the lock states of this rule'] },
    { pattern: /^\/rules\/?$/, prompts: ['Show my stuck rules', 'How many of my rules are in each state?'] },
    { pattern: /^\/did\/[^/]+\/[^/]+\/?$/, prompts: ['Where is this DID replicated?', 'Which rules protect this DID?', 'Make a rule for this DID'] },
    { pattern: /^\/dids\/?$/, prompts: ['Find the datasets in my scope', 'Which of these datasets have no rules?'] },
    { pattern: /^\/rse\/[^/]+\/?$/, prompts: ['Summarise usage and quotas', 'Which protocols does this RSE support?'] },
    { pattern: /^\/rses\/?$/, prompts: ['List the tier 1 disk RSEs', 'Which RSEs are tape?'] },
    { pattern: /^\/subscription\/[^/]+\/[^/]+\/?$/, prompts: ['Summarise the rules of this subscription'] },
    { pattern: /^\/subscriptions\/?$/, prompts: ['Show my subscriptions', 'Which subscriptions have stuck rules?'] },
    { pattern: /^\/account\/[^/]+\/?$/, prompts: ['Summarise this account', 'Is this account close to its quotas?'] },
    { pattern: /^\/accounts\/?$/, prompts: ['Which accounts are over 90% quota?'] },
    { pattern: /^\/(dashboard\/?)?$/, prompts: ['How many of my rules are stuck?', 'Where is my quota running low?', 'What can you do?'] },
];

const DEFAULT_PROMPTS = ['What can you do?', 'How many of my rules are stuck?'];

export const ALL_STARTER_PROMPTS: string[] = [...RULES.flatMap(rule => rule.prompts), ...DEFAULT_PROMPTS];

/** Empty-state suggestions for the page at `pathname`. */
export function starterPromptsFor(pathname: string): string[] {
    return RULES.find(rule => rule.pattern.test(pathname))?.prompts ?? DEFAULT_PROMPTS;
}
