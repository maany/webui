import type { z } from 'zod';

export interface PageActionInfo {
    name: string; // e.g. 'rule_create.prefill'
    description: string;
    inputJsonSchema: unknown;
}

export interface PageActionRegistration<I = unknown> {
    name: string;
    description: string;
    schema: z.ZodType<I>;
    apply(args: I): Promise<string>; // short human/model readable outcome
}

export interface AssistantPageActionRegistryPort {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    register(action: PageActionRegistration<any>): () => void; // returns unregister
    setDescriber(describe: (() => string) | null): void;
    describe(): string | undefined;
    list(): PageActionInfo[];
    invoke(name: string, args: unknown): Promise<string>; // throws ToolError-shaped error on invalid args / unknown action
    waitForActions(timeoutMs: number): Promise<PageActionInfo[]>; // resolves on first registration after a navigation or timeout
}
