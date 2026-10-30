import { FEATURE_REGISTRY, envKeyForFeature, isFeatureEnabledInEnv, resolveEnabledSet } from '@/lib/core/entity/feature-config';

describe('assistant flags', () => {
    it('registers assistant off by default with the settings page', () => {
        expect(FEATURE_REGISTRY.assistant).toEqual({ default: false, pages: ['/assistant/settings'] });
    });

    it('nests write under assistant and bad_replicas under write', () => {
        expect(FEATURE_REGISTRY['assistant.write']).toEqual({ default: false, parent: 'assistant', pages: [] });
        expect(FEATURE_REGISTRY['assistant.bad_replicas']).toEqual({ default: false, parent: 'assistant.write', pages: [] });
    });

    it('maps the keys to FEATURE_ env names', () => {
        expect(envKeyForFeature('assistant')).toBe('FEATURE_ASSISTANT');
        expect(envKeyForFeature('assistant.write')).toBe('FEATURE_ASSISTANT_WRITE');
        expect(envKeyForFeature('assistant.bad_replicas')).toBe('FEATURE_ASSISTANT_BAD_REPLICAS');
    });

    it('is off by default', () => {
        const set = resolveEnabledSet({});
        expect(set.assistant).toBe(false);
        expect(set['assistant.write']).toBe(false);
        expect(set['assistant.bad_replicas']).toBe(false);
    });

    it('needs every parent to be on', () => {
        expect(isFeatureEnabledInEnv('assistant.write', { FEATURE_ASSISTANT_WRITE: 'true' })).toBe(false);
        expect(isFeatureEnabledInEnv('assistant.bad_replicas', { FEATURE_ASSISTANT_BAD_REPLICAS: 'true', FEATURE_ASSISTANT_WRITE: 'true' })).toBe(
            false,
        );
        expect(
            isFeatureEnabledInEnv('assistant.bad_replicas', {
                FEATURE_ASSISTANT: 'true',
                FEATURE_ASSISTANT_WRITE: 'true',
                FEATURE_ASSISTANT_BAD_REPLICAS: 'true',
            }),
        ).toBe(true);
    });
});
