import { FEATURE_REGISTRY, type FeatureFlagMap, type FeatureKey } from '@/lib/core/entity/feature-config';

/** Every registry key false, then the overrides. Robust to new flags. */
export function flagMap(overrides: Partial<FeatureFlagMap> = {}): FeatureFlagMap {
    const map = {} as FeatureFlagMap;
    (Object.keys(FEATURE_REGISTRY) as FeatureKey[]).forEach(key => {
        map[key] = false;
    });
    return { ...map, ...overrides };
}
