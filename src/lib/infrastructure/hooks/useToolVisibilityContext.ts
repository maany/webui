'use client';

import { useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { FEATURE_REGISTRY, type FeatureFlagMap, type FeatureKey } from '@/lib/core/entity/feature-config';
import type { ToolVisibilityContext } from '@/lib/core/services/assistant-policy';
import { useFeatureFlags } from '@/component-library/features/feature-flags/FeatureProvider';
import { usePermissions } from '@/lib/infrastructure/hooks/usePermissions';

/** Used when there is no FeatureProvider (useFeatureFlags returns null): every tool that needs a flag stays hidden. */
const ALL_FLAGS_OFF = Object.fromEntries((Object.keys(FEATURE_REGISTRY) as FeatureKey[]).map(key => [key, false])) as FeatureFlagMap;

/**
 * Inputs for toolVisibility: feature flags, the active account role and permix readiness.
 * Only the role is read from the session, never tokens.
 */
export function useToolVisibilityContext(): ToolVisibilityContext {
    const flags = useFeatureFlags() ?? ALL_FLAGS_OFF;
    const { data: session } = useSession();
    const { isReady } = usePermissions();
    const role = session?.user?.role;
    return useMemo(() => ({ flags, role, permissionsReady: isReady }), [flags, role, isReady]);
}
