import type { z } from 'zod';
import type { ToolRisk } from '@/lib/core/entity/assistant/tool';

export interface PageActionInfo {
    name: string; // e.g. 'rule_create.prefill'
    description: string;
    inputJsonSchema: unknown;
    /** 'read' unless the page says otherwise. Only read actions can run from Rucio bot (no gate path for page actions yet). */
    risk?: ToolRisk;
}

/** What the running turn gives an action: its abort signal and the `account@vo` the turn started under. */
export interface PageActionContext {
    signal?: AbortSignal;
    expectedAccount?: string;
}

export interface PageActionRegistration<I = unknown> {
    name: string;
    description: string;
    schema: z.ZodType<I>;
    apply(args: I, context?: PageActionContext): Promise<string>; // short human/model readable outcome
    risk?: ToolRisk; // defaults to 'read'; a write or high action is refused by the page_action tool
}

export interface AssistantPageActionRegistryPort {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    register(action: PageActionRegistration<any>): () => void; // returns unregister
    setDescriber(describe: (() => string) | null): void;
    describe(): string | undefined;
    list(): PageActionInfo[];
    invoke(name: string, args: unknown, context?: PageActionContext): Promise<string>; // throws ToolError-shaped error on invalid args / unknown action
    waitForActions(timeoutMs: number): Promise<PageActionInfo[]>; // resolves on first registration after a navigation or timeout
}
