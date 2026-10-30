import { act, renderHook, waitFor } from '@testing-library/react';
import type { ResolvedProvider } from '@/lib/core/entity/assistant/provider-config';
import { createAssistantEventBus } from '@/lib/infrastructure/assistant/event-bus';
import { InMemoryConversationRepository } from '@/lib/infrastructure/assistant/in-memory-conversation-repository';
import type { AgentRunner, RunnerUpdate } from '@/lib/infrastructure/assistant/tanstack-agent-runner';
import type { ToolExecutionContext } from '@/lib/infrastructure/assistant/tool-types';
import { resetToolRegistryForTests } from '@/lib/infrastructure/assistant/tool-registry';
import { useAssistantController, type AssistantControllerDeps } from '@/lib/infrastructure/hooks/useAssistant';
import { makeNoopHandles, makePages } from 'test/fixtures/assistant-fixtures';

const PROVIDER: ResolvedProvider = {
    providerId: 'operator',
    kind: 'openai-compatible',
    model: 'fake-model',
    baseURL: '/api/assistant/llm',
    via: 'relay',
    contextWindow: 1_000,
};

// A runner that builds its tool context like the real one, then waits until the test releases it.
function setup() {
    const repository = new InMemoryConversationRepository();
    const navigate = jest.fn();
    const minimizePanel = jest.fn();
    let ctx!: ToolExecutionContext;
    let release!: () => void;
    const runner: AgentRunner = {
        async *run(input): AsyncGenerator<RunnerUpdate> {
            ctx = (factoryRef.current() as unknown as { makeToolContext: (id: string, turn: string) => ToolExecutionContext }).makeToolContext(
                'call-1',
                input.turnId,
            );
            await new Promise<void>(resolve => {
                release = resolve;
                input.signal.addEventListener('abort', () => resolve());
            });
            yield { type: 'finished', status: 'stopped' };
        },
        resolveApproval: jest.fn(),
    };
    const factoryRef = { current: (() => undefined) as unknown as () => unknown };
    const createRunner = jest.fn((factory: () => unknown) => {
        factoryRef.current = factory;
        return runner;
    });
    let active = true;
    const deps = (): AssistantControllerDeps => ({
        accountKey: 'root@def',
        sessionActive: () => active,
        repository: Promise.resolve({ repository, persistent: true }),
        resolveProvider: () => PROVIDER,
        visibleTools: () => [],
        makePolicyFor: () => () => 'allow',
        toolContextExtras: () => ({ minimizePanel }),
        pageContext: () => undefined,
        retention: () => ({ maxAgeDays: 30, maxTotalMB: 50, clearOnLogout: false }),
        handles: makeNoopHandles(),
        pages: makePages(),
        bus: createAssistantEventBus(),
        navigate,
        queryClient: {} as AssistantControllerDeps['queryClient'],
        createRunner: createRunner as unknown as AssistantControllerDeps['createRunner'],
        summarize: jest.fn().mockResolvedValue({ text: '' }),
    });
    const hook = renderHook(() => useAssistantController(deps()));
    return { hook, navigate, minimizePanel, getCtx: () => ctx, release: () => release(), setActive: (v: boolean) => (active = v) };
}

afterEach(() => resetToolRegistryForTests());

async function startTurn(s: ReturnType<typeof setup>) {
    let sending!: Promise<void>;
    act(() => {
        sending = s.hook.result.current.send('go');
    });
    await waitFor(() => expect(s.getCtx()).toBeDefined());
    return { sending };
}

describe('tool context navigate and minimizePanel', () => {
    it('act while the owning turn is live', async () => {
        const s = setup();
        const { sending } = await startTurn(s);
        s.getCtx().navigate('/rules');
        s.getCtx().minimizePanel?.();
        expect(s.navigate).toHaveBeenCalledWith('/rules');
        expect(s.minimizePanel).toHaveBeenCalledTimes(1);
        await act(async () => {
            s.release();
            await sending;
        });
    });

    it('do nothing after the turn was stopped', async () => {
        const s = setup();
        const { sending } = await startTurn(s);
        const ctx = s.getCtx();
        await act(async () => {
            s.hook.result.current.stop();
            await sending;
        });
        ctx.navigate('/rules');
        ctx.minimizePanel?.();
        expect(s.navigate).not.toHaveBeenCalled();
        expect(s.minimizePanel).not.toHaveBeenCalled();
    });

    it('do nothing once another conversation replaced the turn', async () => {
        const s = setup();
        const { sending } = await startTurn(s);
        const ctx = s.getCtx();
        act(() => s.hook.result.current.newConversation());
        ctx.navigate('/rules');
        ctx.minimizePanel?.();
        expect(s.navigate).not.toHaveBeenCalled();
        expect(s.minimizePanel).not.toHaveBeenCalled();
        await act(async () => {
            s.release();
            await sending;
        });
    });

    it('do nothing while the session is not active', async () => {
        const s = setup();
        const { sending } = await startTurn(s);
        s.setActive(false);
        s.getCtx().navigate('/rules');
        s.getCtx().minimizePanel?.();
        expect(s.navigate).not.toHaveBeenCalled();
        expect(s.minimizePanel).not.toHaveBeenCalled();
        await act(async () => {
            s.release();
            await sending;
        });
    });
});
