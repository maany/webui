import { effectiveContentLevel, isContentLevelAllowed, isUserSinkComplete, resolveTelemetryPlan } from '@/lib/core/services/assistant-telemetry';
import type { AssistantConfig, TelemetryContentLevel } from '@/lib/core/entity/assistant/assistant-config';
import type { AssistantSettings } from '@/lib/core/entity/assistant/settings';

const config = (patch: Partial<AssistantConfig['telemetry']> = {}): AssistantConfig['telemetry'] => ({
    operatorSink: false,
    allowUserSinks: true,
    contentCap: 'full',
    hashUser: false,
    ...patch,
});

const langfuse = { kind: 'langfuse' as const, endpoint: 'https://cloud.langfuse.com', publicKey: 'pk-lf-1', secretKey: 'sk-lf-1' };

const settings = (patch: Partial<AssistantSettings['telemetry']> = {}): AssistantSettings['telemetry'] => ({
    enabled: true,
    contentLevel: 'full',
    sink: langfuse,
    shareWithOperator: false,
    ...patch,
});

describe('effectiveContentLevel', () => {
    it.each<[TelemetryContentLevel, TelemetryContentLevel, TelemetryContentLevel]>([
        ['metadata', 'metadata', 'metadata'],
        ['metadata', 'full', 'metadata'],
        ['full', 'metadata', 'metadata'],
        ['full', 'full', 'full'],
    ])('user %s with cap %s gives %s', (requested, cap, expected) => {
        expect(effectiveContentLevel(requested, cap)).toBe(expected);
    });

    it('treats an unknown stored value as metadata', () => {
        expect(effectiveContentLevel('everything' as TelemetryContentLevel, 'full')).toBe('metadata');
    });
});

describe('isContentLevelAllowed', () => {
    it('allows levels up to the cap only', () => {
        expect(isContentLevelAllowed('metadata', 'metadata')).toBe(true);
        expect(isContentLevelAllowed('full', 'metadata')).toBe(false);
        expect(isContentLevelAllowed('full', 'full')).toBe(true);
    });
});

describe('isUserSinkComplete', () => {
    it('needs an endpoint', () => {
        expect(isUserSinkComplete(undefined)).toBe(false);
        expect(isUserSinkComplete({ kind: 'otlp', endpoint: '  ' })).toBe(false);
        expect(isUserSinkComplete({ kind: 'otlp', endpoint: 'https://otel.example.org/v1/traces' })).toBe(true);
    });

    it('needs both keys for langfuse', () => {
        expect(isUserSinkComplete({ ...langfuse, secretKey: '' })).toBe(false);
        expect(isUserSinkComplete({ ...langfuse, publicKey: undefined })).toBe(false);
        expect(isUserSinkComplete(langfuse)).toBe(true);
    });
});

describe('resolveTelemetryPlan', () => {
    it('returns null when nothing exports', () => {
        expect(resolveTelemetryPlan(settings({ enabled: false }), config())).toBeNull();
        expect(resolveTelemetryPlan(settings({ sink: undefined }), config())).toBeNull();
    });

    it('never exports to the operator without the user opting in', () => {
        expect(resolveTelemetryPlan(settings({ enabled: false }), config({ operatorSink: true }))).toBeNull();
        expect(resolveTelemetryPlan(settings(), config({ operatorSink: true }))).toEqual({
            userSink: langfuse,
            operatorSink: false,
            contentLevel: 'full',
        });
    });

    it('exports to the operator after the user opts in, without a personal sink', () => {
        expect(resolveTelemetryPlan(settings({ enabled: false, shareWithOperator: true }), config({ operatorSink: true }))).toEqual({
            userSink: undefined,
            operatorSink: true,
            contentLevel: 'full',
        });
    });

    it('ignores the opt-in when the operator has no sink, and drops disallowed user sinks', () => {
        expect(resolveTelemetryPlan(settings({ enabled: false, shareWithOperator: true }), config())).toBeNull();
        expect(resolveTelemetryPlan(settings(), config({ allowUserSinks: false }))).toBeNull();
        expect(resolveTelemetryPlan(settings({ shareWithOperator: true }), config({ allowUserSinks: false, operatorSink: true }))).toEqual({
            userSink: undefined,
            operatorSink: true,
            contentLevel: 'full',
        });
    });

    it('runs both sinks at the capped level', () => {
        expect(resolveTelemetryPlan(settings({ shareWithOperator: true }), config({ operatorSink: true, contentCap: 'metadata' }))).toEqual({
            userSink: langfuse,
            operatorSink: true,
            contentLevel: 'metadata',
        });
    });
});
