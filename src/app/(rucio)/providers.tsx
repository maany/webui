'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import React from 'react';
import { CommandPaletteProvider } from '@/lib/infrastructure/hooks/useCommandPalette';
import { CommandPaletteWrapper } from '@/component-library/features/command-palette';
import { TipsProvider } from '@/lib/infrastructure/hooks/useTips';
import { TipsPanelWrapper } from '@/component-library/features/tips';
import { PermissionProvider } from '@/lib/infrastructure/permissions';
import { SessionMonitorProvider } from '@/lib/infrastructure/auth/session-monitor';
import { AssistantShellProvider } from '@/lib/infrastructure/hooks/useAssistantShell';
import { AssistantMount } from '@/component-library/features/assistant/AssistantMount';

/**
 * Client component that provides React Query, Command Palette, and Tips context.
 * This is separated from the server layout to enable server-side data fetching.
 */
export function Providers({ children }: { children: React.ReactNode }) {
    const [queryClient] = React.useState(() => new QueryClient());

    return (
        <SessionMonitorProvider>
            <QueryClientProvider client={queryClient}>
                <PermissionProvider>
                    <CommandPaletteProvider>
                        <TipsProvider>
                            <AssistantShellProvider>
                                {children}
                                <CommandPaletteWrapper />
                                <TipsPanelWrapper />
                                <AssistantMount />
                                <ReactQueryDevtools initialIsOpen={false} />
                            </AssistantShellProvider>
                        </TipsProvider>
                    </CommandPaletteProvider>
                </PermissionProvider>
            </QueryClientProvider>
        </SessionMonitorProvider>
    );
}
