import React, { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
    TELEMETRY_PENDING_EVENT_LIMIT,
    useAssistantTelemetry,
    type UseAssistantTelemetryInput,
} from '@/lib/infrastructure/hooks/useAssistantTelemetry';
import type { AssistantConfig } from '@/lib/core/entity/assistant/assistant-config';
import type { AssistantSettings } from '@/lib/core/entity/assistant/settings';
import type { AssistantEvent } from '@/lib/core/entity/assistant/events';
import type { StartAssistantTelemetryOptions } from '@/lib/infrastructure/assistant/telemetry';

const handle = jest.fn();
const shutdown = jest.fn(async () => undefined);
const startAssistantTelemetry = jest.fn((options: StartAssistantTelemetryOptions) => {
    void options;
    return { handle, shutdown, forceFlush: jest.fn(async () => undefined) };
});

jest.mock('@/lib/infrastructure/assistant/telemetry', () => ({
    __esModule: true,
    startAssistantTelemetry: (options: StartAssistantTelemetryOptions) => startAssistantTelemetry(options),
}));

const mockTools: Record<string, { spec: object }> = {
    add_account_identity: { spec: { name: 'add_account_identity', sensitiveArgs: ['password'] } },
    list_rules: { spec: { name: 'list_rules' } },
};

jest.mock('@/lib/infrastructure/assistant/tool-registry', () => ({
    __esModule: true,
    getTool: (name: string) => mockTools[name],
}));

const telemetryConfig = (patch: Partial<AssistantConfig['telemetry']> = {}): AssistantConfig['telemetry'] => ({
    operatorSink: false,
    allowUserSinks: true,
    contentCap: 'full',
    hashUser: false,
    ...patch,
});

const settingsWith = (telemetry: Partial<AssistantSettings['telemetry']> = {}): AssistantSettings =>
    ({
        version: 1,
        providers: [{ id: 'p1', kind: 'openai', label: 'OpenAI', model: 'gpt-5', apiKey: 'sk-provider-secret-1' }],
        activeProviderId: 'p1',
        keyStorage: 'local',
        toolPolicies: {},
        skills: { enabled: {}, user: [] },
        telemetry: {
            enabled: true,
            contentLevel: 'full',
            sink: { kind: 'langfuse', endpoint: 'https://cloud.langfuse.com', publicKey: 'pk-lf-1', secretKey: 'sk-lf-1' },
            shareWithOperator: false,
            ...telemetry,
        },
        display: { detail: 'compact' },
        retention: { maxAgeDays: 30, maxTotalMB: 50, clearOnLogout: false },
    } as AssistantSettings);

const started: AssistantEvent = { type: 'turn-started', conversationId: 'c1', turnId: 't1', providerKind: 'openai', model: 'gpt-5', at: 1 };

const lastOptions = () => startAssistantTelemetry.mock.calls[startAssistantTelemetry.mock.calls.length - 1][0];

describe('useAssistantTelemetry', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('does not load telemetry while config is loading or nothing is enabled', async () => {
        const { result, rerender } = renderHook((props: UseAssistantTelemetryInput) => useAssistantTelemetry(props), {
            initialProps: { config: undefined, settings: settingsWith(), accountKey: 'root@def' } as UseAssistantTelemetryInput,
        });
        rerender({ config: telemetryConfig(), settings: settingsWith({ enabled: false }), accountKey: 'root@def' });
        act(() => result.current(started));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(startAssistantTelemetry).not.toHaveBeenCalled();
        expect(handle).not.toHaveBeenCalled();
    });

    it('starts the user sink, replays events sent while loading and forwards later ones', async () => {
        const { result } = renderHook(() => useAssistantTelemetry({ config: telemetryConfig(), settings: settingsWith(), accountKey: 'root@def' }));
        act(() => result.current(started));
        await waitFor(() => expect(startAssistantTelemetry).toHaveBeenCalledTimes(1));
        expect(lastOptions().userSink).toEqual({
            url: 'https://cloud.langfuse.com/api/public/otel/v1/traces',
            headers: { Authorization: `Basic ${btoa('pk-lf-1:sk-lf-1')}`, 'x-langfuse-ingestion-version': '4' },
        });
        expect(lastOptions().operatorSink).toBeUndefined();
        expect(handle).toHaveBeenCalledWith(started);
        const finished: AssistantEvent = {
            type: 'turn-finished',
            turnId: 't1',
            status: 'completed',
            usage: { inputTokens: 1, outputTokens: 1, costUSD: null, durationMs: 1 },
            at: 2,
        };
        act(() => result.current(finished));
        expect(handle).toHaveBeenLastCalledWith(finished);
    });

    it('does not add the operator relay without opt-in', async () => {
        renderHook(() =>
            useAssistantTelemetry({
                config: telemetryConfig({ operatorSink: true }),
                settings: settingsWith({ enabled: false }),
                accountKey: 'root@def',
            }),
        );
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(startAssistantTelemetry).not.toHaveBeenCalled();
    });

    it('adds the operator relay after the user opts in, even without a user sink', async () => {
        renderHook(() =>
            useAssistantTelemetry({
                config: telemetryConfig({ operatorSink: true }),
                settings: settingsWith({ enabled: false, shareWithOperator: true }),
                accountKey: undefined,
            }),
        );
        await waitFor(() => expect(startAssistantTelemetry).toHaveBeenCalledTimes(1));
        expect(lastOptions().userSink).toBeUndefined();
        expect(lastOptions().operatorSink).toEqual({ url: 'http://localhost/api/assistant/telemetry', headers: {} });
    });

    it('stops exporting to the operator when the user opts out', async () => {
        const { result, rerender } = renderHook((props: UseAssistantTelemetryInput) => useAssistantTelemetry(props), {
            initialProps: {
                config: telemetryConfig({ operatorSink: true }),
                settings: settingsWith({ enabled: false, shareWithOperator: true }),
                accountKey: 'root@def',
            },
        });
        await waitFor(() => expect(startAssistantTelemetry).toHaveBeenCalledTimes(1));
        rerender({
            config: telemetryConfig({ operatorSink: true }),
            settings: settingsWith({ enabled: false, shareWithOperator: false }),
            accountKey: 'root@def',
        });
        expect(shutdown).toHaveBeenCalledTimes(1);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(startAssistantTelemetry).toHaveBeenCalledTimes(1);
        act(() => result.current(started));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(handle).not.toHaveBeenCalled();
    });

    it('reads content level and secrets live without restarting', async () => {
        const { rerender } = renderHook((props: UseAssistantTelemetryInput) => useAssistantTelemetry(props), {
            initialProps: { config: telemetryConfig(), settings: settingsWith(), accountKey: 'root@def' },
        });
        await waitFor(() => expect(startAssistantTelemetry).toHaveBeenCalledTimes(1));
        const options = lastOptions();
        expect(options.contentLevel()).toBe('full');
        expect(options.secrets()).toContain('sk-provider-secret-1');
        rerender({ config: telemetryConfig({ contentCap: 'metadata' }), settings: settingsWith(), accountKey: 'root@def' });
        expect(options.contentLevel()).toBe('metadata');
        expect(startAssistantTelemetry).toHaveBeenCalledTimes(1);
    });

    it('restarts when the sink changes and shuts down on unmount', async () => {
        const { rerender, unmount } = renderHook((props: UseAssistantTelemetryInput) => useAssistantTelemetry(props), {
            initialProps: { config: telemetryConfig(), settings: settingsWith(), accountKey: 'root@def' },
        });
        await waitFor(() => expect(startAssistantTelemetry).toHaveBeenCalledTimes(1));
        rerender({
            config: telemetryConfig(),
            settings: settingsWith({ sink: { kind: 'otlp', endpoint: 'https://otel.example.org/v1/traces' } }),
            accountKey: 'root@def',
        });
        await waitFor(() => expect(startAssistantTelemetry).toHaveBeenCalledTimes(2));
        expect(shutdown).toHaveBeenCalledTimes(1);
        expect(lastOptions().userSink).toEqual({ url: 'https://otel.example.org/v1/traces', headers: {} });
        unmount();
        expect(shutdown).toHaveBeenCalledTimes(2);
    });

    it('stops exporting when the operator disallows user sinks', async () => {
        const { result, rerender } = renderHook((props: UseAssistantTelemetryInput) => useAssistantTelemetry(props), {
            initialProps: { config: telemetryConfig(), settings: settingsWith(), accountKey: 'root@def' },
        });
        await waitFor(() => expect(startAssistantTelemetry).toHaveBeenCalledTimes(1));
        rerender({ config: telemetryConfig({ allowUserSinks: false }), settings: settingsWith(), accountKey: 'root@def' });
        expect(shutdown).toHaveBeenCalledTimes(1);
        act(() => result.current(started));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(handle).not.toHaveBeenCalled();
        expect(startAssistantTelemetry).toHaveBeenCalledTimes(1);
    });

    it('reads sensitive argument names from the tool registry', async () => {
        renderHook(() => useAssistantTelemetry({ config: telemetryConfig(), settings: settingsWith(), accountKey: 'root@def' }));
        await waitFor(() => expect(startAssistantTelemetry).toHaveBeenCalledTimes(1));
        const { sensitiveArgs } = lastOptions();
        expect(sensitiveArgs?.('add_account_identity')).toEqual(['password']);
        expect(sensitiveArgs?.('list_rules')).toEqual([]);
        expect(sensitiveArgs?.('unknown_tool')).toEqual([]);
    });

    it('passes the raw account key and never hashes in the browser, even with hashUser on', async () => {
        const { rerender } = renderHook((props: UseAssistantTelemetryInput) => useAssistantTelemetry(props), {
            initialProps: { config: telemetryConfig(), settings: settingsWith(), accountKey: 'root@def' },
        });
        await waitFor(() => expect(startAssistantTelemetry).toHaveBeenCalledTimes(1));
        const { identity } = lastOptions();
        expect(identity.userId()).toBe('root@def');
        rerender({ config: telemetryConfig({ hashUser: true }), settings: settingsWith(), accountKey: 'root@def' });
        expect(identity.userId()).toBe('root@def');
        rerender({ config: telemetryConfig({ hashUser: true }), settings: settingsWith(), accountKey: 'jdoe@cms' });
        expect(identity.userId()).toBe('jdoe@cms');
        expect(startAssistantTelemetry).toHaveBeenCalledTimes(1);
    });
    describe('lifecycle races', () => {
        const startedAt = (at: number): AssistantEvent => ({ ...started, at } as AssistantEvent);

        it('never starts when unmounted before the chunk resolves', async () => {
            const { result, unmount } = renderHook(() =>
                useAssistantTelemetry({ config: telemetryConfig(), settings: settingsWith(), accountKey: 'root@def' }),
            );
            act(() => result.current(started));
            unmount();
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(startAssistantTelemetry).not.toHaveBeenCalled();
            expect(handle).not.toHaveBeenCalled();
            expect(shutdown).not.toHaveBeenCalled();
        });

        it('starts one instance and shuts it down once under strict mode double effects', async () => {
            const { unmount } = renderHook(
                () => useAssistantTelemetry({ config: telemetryConfig(), settings: settingsWith(), accountKey: 'root@def' }),
                {
                    wrapper: ({ children }: { children: React.ReactNode }) => <StrictMode>{children}</StrictMode>,
                },
            );
            await waitFor(() => expect(startAssistantTelemetry).toHaveBeenCalled());
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(startAssistantTelemetry).toHaveBeenCalledTimes(1);
            expect(shutdown).not.toHaveBeenCalled();
            unmount();
            expect(shutdown).toHaveBeenCalledTimes(1);
        });

        it('starts only the latest target when the sink changes before the chunk resolves, replaying only events queued for it', async () => {
            const { result, rerender } = renderHook((props: UseAssistantTelemetryInput) => useAssistantTelemetry(props), {
                initialProps: { config: telemetryConfig(), settings: settingsWith(), accountKey: 'root@def' },
            });
            act(() => result.current(startedAt(1)));
            rerender({
                config: telemetryConfig(),
                settings: settingsWith({ sink: { kind: 'otlp', endpoint: 'https://otel.example.org/v1/traces' } }),
                accountKey: 'root@def',
            });
            act(() => result.current(startedAt(2)));
            await waitFor(() => expect(startAssistantTelemetry).toHaveBeenCalled());
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(startAssistantTelemetry).toHaveBeenCalledTimes(1);
            expect(lastOptions().userSink?.url).toBe('https://otel.example.org/v1/traces');
            // The queue belongs to its sink set: events queued for the earlier sink are not replayed to the new one.
            expect(handle.mock.calls.map(call => (call[0] as { at: number }).at)).toEqual([2]);
            expect(shutdown).not.toHaveBeenCalled();
        });

        it('never replays events queued before the user opted in to the operator sink', async () => {
            const { result, rerender } = renderHook((props: UseAssistantTelemetryInput) => useAssistantTelemetry(props), {
                initialProps: { config: telemetryConfig({ operatorSink: true }), settings: settingsWith(), accountKey: 'root@def' },
            });
            act(() => result.current(startedAt(1)));
            rerender({
                config: telemetryConfig({ operatorSink: true }),
                settings: settingsWith({ shareWithOperator: true }),
                accountKey: 'root@def',
            });
            act(() => result.current(startedAt(2)));
            await waitFor(() => expect(startAssistantTelemetry).toHaveBeenCalled());
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(startAssistantTelemetry).toHaveBeenCalledTimes(1);
            expect(lastOptions().operatorSink).toBeDefined();
            expect(handle.mock.calls.map(call => (call[0] as { at: number }).at)).toEqual([2]);
        });

        it('drops queued events when the sink is removed before the chunk resolves', async () => {
            const { result, rerender } = renderHook((props: UseAssistantTelemetryInput) => useAssistantTelemetry(props), {
                initialProps: { config: telemetryConfig(), settings: settingsWith(), accountKey: 'root@def' },
            });
            act(() => result.current(started));
            rerender({ config: telemetryConfig(), settings: settingsWith({ enabled: false }), accountKey: 'root@def' });
            await new Promise(resolve => setTimeout(resolve, 0));
            act(() => result.current(startedAt(5)));
            expect(startAssistantTelemetry).not.toHaveBeenCalled();
            expect(handle).not.toHaveBeenCalled();
        });

        it('queues events sent after a restart until the new instance starts', async () => {
            const { result, rerender } = renderHook((props: UseAssistantTelemetryInput) => useAssistantTelemetry(props), {
                initialProps: { config: telemetryConfig(), settings: settingsWith(), accountKey: 'root@def' },
            });
            await waitFor(() => expect(startAssistantTelemetry).toHaveBeenCalledTimes(1));
            rerender({
                config: telemetryConfig(),
                settings: settingsWith({ sink: { kind: 'otlp', endpoint: 'https://otel.example.org/v1/traces' } }),
                accountKey: 'root@def',
            });
            act(() => result.current(startedAt(7)));
            expect(handle).not.toHaveBeenCalled();
            await waitFor(() => expect(startAssistantTelemetry).toHaveBeenCalledTimes(2));
            expect(handle).toHaveBeenCalledWith(startedAt(7));
        });

        it('queues at most the pending limit and replays them in order', async () => {
            const { result } = renderHook(() =>
                useAssistantTelemetry({ config: telemetryConfig(), settings: settingsWith(), accountKey: 'root@def' }),
            );
            act(() => {
                for (let i = 0; i < TELEMETRY_PENDING_EVENT_LIMIT + 20; i += 1) {
                    result.current(startedAt(i));
                }
            });
            await waitFor(() => expect(handle).toHaveBeenCalledTimes(TELEMETRY_PENDING_EVENT_LIMIT));
            expect((handle.mock.calls[0][0] as { at: number }).at).toBe(0);
            expect((handle.mock.calls[TELEMETRY_PENDING_EVENT_LIMIT - 1][0] as { at: number }).at).toBe(TELEMETRY_PENDING_EVENT_LIMIT - 1);
        });

        it('does not throw into the caller when the runtime fails to start or handle an event', async () => {
            startAssistantTelemetry.mockImplementationOnce(() => {
                throw new Error('boom');
            });
            const { result } = renderHook(() =>
                useAssistantTelemetry({ config: telemetryConfig(), settings: settingsWith(), accountKey: 'root@def' }),
            );
            act(() => result.current(started));
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(() => act(() => result.current(started))).not.toThrow();
            expect(handle).not.toHaveBeenCalled();
        });

        it('keeps replaying and forwarding when handle throws, and survives a rejecting shutdown', async () => {
            handle.mockImplementationOnce(() => {
                throw new Error('bad event');
            });
            shutdown.mockImplementationOnce(async () => {
                throw new Error('flush failed');
            });
            const { result, unmount } = renderHook(() =>
                useAssistantTelemetry({ config: telemetryConfig(), settings: settingsWith(), accountKey: 'root@def' }),
            );
            act(() => {
                result.current(startedAt(1));
                result.current(startedAt(2));
            });
            await waitFor(() => expect(handle).toHaveBeenCalledTimes(2));
            expect(() => act(() => result.current(startedAt(3)))).not.toThrow();
            expect(handle).toHaveBeenCalledTimes(3);
            unmount();
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(shutdown).toHaveBeenCalledTimes(1);
        });
    });
});
