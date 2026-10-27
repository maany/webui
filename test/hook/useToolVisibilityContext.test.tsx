jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('@/lib/infrastructure/hooks/usePermissions', () => ({ usePermissions: jest.fn() }));

import React from 'react';
import { renderHook } from '@testing-library/react';
import { useSession } from 'next-auth/react';
import { Role } from '@/lib/core/entity/auth-models';
import { FeatureProvider } from '@/component-library/features/feature-flags/FeatureProvider';
import { usePermissions } from '@/lib/infrastructure/hooks/usePermissions';
import { useToolVisibilityContext } from '@/lib/infrastructure/hooks/useToolVisibilityContext';
import { ALL_FLAGS_ON } from 'test/fixtures/assistant-write-fixtures';

const wrapperWith =
    (flags = ALL_FLAGS_ON) =>
    // eslint-disable-next-line react/display-name
    ({ children }: { children: React.ReactNode }) =>
        <FeatureProvider features={flags}>{children}</FeatureProvider>;

describe('useToolVisibilityContext', () => {
    beforeEach(() => {
        jest.mocked(useSession).mockReturnValue({ data: { user: { role: Role.ADMIN } }, status: 'authenticated', update: jest.fn() } as never);
        jest.mocked(usePermissions).mockReturnValue({ isReady: true, check: jest.fn() } as never);
    });

    it('combines flags, the session role and permix readiness', () => {
        const { result } = renderHook(() => useToolVisibilityContext(), { wrapper: wrapperWith() });
        expect(result.current).toEqual({ flags: ALL_FLAGS_ON, role: Role.ADMIN, permissionsReady: true });
    });

    it('reports not ready while permix loads', () => {
        jest.mocked(usePermissions).mockReturnValue({ isReady: false, check: jest.fn() } as never);
        const { result } = renderHook(() => useToolVisibilityContext(), { wrapper: wrapperWith() });
        expect(result.current.permissionsReady).toBe(false);
    });

    it('has no role without a session', () => {
        jest.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated', update: jest.fn() } as never);
        const { result } = renderHook(() => useToolVisibilityContext(), { wrapper: wrapperWith() });
        expect(result.current.role).toBeUndefined();
    });

    it('fails safe with every flag off without a FeatureProvider', () => {
        const { result } = renderHook(() => useToolVisibilityContext());
        expect(Object.values(result.current.flags).every(value => value === false)).toBe(true);
        expect(result.current.flags['assistant.write']).toBe(false);
    });

    it('keeps the same object between renders when nothing changed', () => {
        const { result, rerender } = renderHook(() => useToolVisibilityContext(), { wrapper: wrapperWith() });
        const first = result.current;
        rerender();
        expect(result.current).toBe(first);
    });
});
