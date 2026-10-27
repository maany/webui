import { z } from 'zod';
import type {
    AssistantPageActionRegistryPort,
    PageActionContext,
    PageActionInfo,
    PageActionRegistration,
} from '@/lib/core/port/secondary/assistant-page-action-registry-port';

/**
 * In-memory registry following AssistantPageActionRegistryPort, for tests.
 * waitForActions resolves on the next registration or after the timeout.
 */
export class FakePageActionRegistry implements AssistantPageActionRegistryPort {
    registerCount = 0;
    private readonly actions = new Map<string, PageActionRegistration<any>>();
    private describer: (() => string) | null = null;
    private waiters: Array<() => void> = [];

    register(action: PageActionRegistration<any>): () => void {
        this.registerCount += 1;
        this.actions.set(action.name, action);
        const waiting = this.waiters;
        this.waiters = [];
        waiting.forEach(wake => wake());
        return () => {
            if (this.actions.get(action.name) === action) this.actions.delete(action.name);
        };
    }

    setDescriber(describe: (() => string) | null): void {
        this.describer = describe;
    }

    describe(): string | undefined {
        return this.describer ? this.describer() : undefined;
    }

    list(): PageActionInfo[] {
        return [...this.actions.values()].map(action => ({
            name: action.name,
            description: action.description,
            inputJsonSchema: z.toJSONSchema(action.schema),
            risk: action.risk ?? 'read',
        }));
    }

    async invoke(name: string, args: unknown, context?: PageActionContext): Promise<string> {
        const action = this.actions.get(name);
        if (!action) throw { error: 'not_found', message: `This page has no action named ${name}.` };
        const parsed = action.schema.safeParse(args);
        if (!parsed.success) throw { error: 'invalid_args', message: z.prettifyError(parsed.error) };
        return action.apply(parsed.data, context);
    }

    waitForActions(timeoutMs: number): Promise<PageActionInfo[]> {
        return new Promise(resolve => {
            let timer: ReturnType<typeof setTimeout> | undefined = undefined;
            const wake = () => {
                if (timer !== undefined) clearTimeout(timer);
                resolve(this.list());
            };
            timer = setTimeout(() => {
                this.waiters = this.waiters.filter(waiter => waiter !== wake);
                resolve(this.list());
            }, timeoutMs);
            this.waiters.push(wake);
        });
    }
}
