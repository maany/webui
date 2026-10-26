import { render } from '@testing-library/react';
import { DEFAULT_ASSISTANT_CONFIG } from '@/lib/core/entity/assistant/assistant-config';
import { AssistantTelemetryBridge } from '@/component-library/features/assistant/AssistantTelemetryBridge';

const listener = jest.fn();
const useAssistantTelemetry = jest.fn((input: unknown) => {
    void input;
    return listener;
});
const useAssistantEvents = jest.fn();
let configState: { config: typeof DEFAULT_ASSISTANT_CONFIG; isLoading: boolean; error?: Error } = {
    config: DEFAULT_ASSISTANT_CONFIG,
    isLoading: true,
};
const settings = { telemetry: { enabled: false, contentLevel: 'metadata' } };

jest.mock('@/lib/infrastructure/hooks/useAssistantTelemetry', () => ({ useAssistantTelemetry: (input: unknown) => useAssistantTelemetry(input) }));
jest.mock('@/lib/infrastructure/hooks/useAssistantConfig', () => ({ useAssistantConfig: () => configState }));
jest.mock('@/lib/infrastructure/hooks/useAssistantSettings', () => ({ useAssistantSettings: () => ({ settings, update: jest.fn() }) }));
jest.mock('@/lib/infrastructure/hooks/useAssistant', () => ({ useAssistant: () => ({ conversation: { accountKey: 'root@def' } }) }));
jest.mock('@/component-library/features/assistant/AssistantProvider', () => ({ useAssistantEvents: (l: unknown) => useAssistantEvents(l) }));

describe('AssistantTelemetryBridge', () => {
    it('passes no config while loading, then the operator telemetry config, and subscribes the listener', () => {
        const { rerender, container } = render(<AssistantTelemetryBridge />);
        expect(container).toBeEmptyDOMElement();
        expect(useAssistantTelemetry).toHaveBeenLastCalledWith({ config: undefined, settings, accountKey: 'root@def' });
        configState = { config: DEFAULT_ASSISTANT_CONFIG, isLoading: false };
        rerender(<AssistantTelemetryBridge />);
        expect(useAssistantTelemetry).toHaveBeenLastCalledWith({ config: DEFAULT_ASSISTANT_CONFIG.telemetry, settings, accountKey: 'root@def' });
        expect(useAssistantEvents).toHaveBeenLastCalledWith(listener);
    });

    it('passes no config when the config query failed, so a default allowUserSinks cannot re-enable a sink', () => {
        configState = { config: DEFAULT_ASSISTANT_CONFIG, isLoading: false, error: new Error('x') };
        render(<AssistantTelemetryBridge />);
        expect(useAssistantTelemetry).toHaveBeenLastCalledWith({ config: undefined, settings, accountKey: 'root@def' });
    });
});
