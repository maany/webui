'use client';

import React, { useEffect, useState } from 'react';
import { useSessionGate } from '@/lib/infrastructure/auth/session-gate';
import { useAssistant } from '@/lib/infrastructure/hooks/useAssistant';
import { ASSISTANT_INERT_TARGET_ID, ASSISTANT_MOBILE_QUERY, useAssistantPanel } from '@/lib/infrastructure/hooks/useAssistantShell';
import { useAssistantSettings } from '@/lib/infrastructure/hooks/useAssistantSettings';
import { useVisualViewportInset } from '@/lib/infrastructure/hooks/useVisualViewportInset';
import { clampPanelWidth, loadPanelWidth, savePanelWidth } from '@/lib/infrastructure/assistant/panel-storage';
import { AssistantPanelView } from './AssistantPanelView';
import { StarterPrompts } from './StarterPrompts';

const OFFSET_PROPERTY = '--rucio-assistant-offset';

function useIsMobile(): boolean {
    const [mobile, setMobile] = useState(false);
    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return;
        const query = window.matchMedia(ASSISTANT_MOBILE_QUERY);
        const update = () => setMobile(query.matches);
        update();
        query.addEventListener('change', update);
        return () => query.removeEventListener('change', update);
    }, []);
    return mobile;
}

/** Connects the panel view to the chat controller and the shell. */
export function AssistantPanel() {
    const assistant = useAssistant();
    const shell = useAssistantPanel();
    const blocked = useSessionGate().status !== 'active';
    const { settings } = useAssistantSettings();
    const isMobile = useIsMobile();
    const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
    // The stored width is the preference; what is shown never exceeds 45% of the viewport.
    const [preferredWidth, setPreferredWidth] = useState(() => loadPanelWidth());
    const width = clampPanelWidth(preferredWidth, viewportWidth);
    const keyboardInset = useVisualViewportInset(isMobile && shell.panelState === 'open');
    const open = shell.panelState === 'open';

    useEffect(() => {
        const onResize = () => setViewportWidth(window.innerWidth);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    // Docked on desktop: the page and header shrink by the panel width (Layout reads the variable).
    useEffect(() => {
        const root = document.documentElement;
        if (open && !isMobile) root.style.setProperty(OFFSET_PROPERTY, `${width}px`);
        else root.style.removeProperty(OFFSET_PROPERTY);
        return () => {
            root.style.removeProperty(OFFSET_PROPERTY);
        };
    }, [open, isMobile, width]);

    // The full-screen sheet is modal in effect: the page behind it must not take focus or clicks.
    // Skipped while blocked: the re-auth dialog must stay usable, and the panel itself is already inert.
    const sheetOpen = open && isMobile && !blocked;
    useEffect(() => {
        if (!sheetOpen) return;
        const target = document.getElementById(ASSISTANT_INERT_TARGET_ID);
        target?.setAttribute('inert', '');
        return () => target?.removeAttribute('inert');
    }, [sheetOpen]);

    if (shell.panelState === 'closed') return null;

    return (
        <AssistantPanelView
            state={shell.panelState}
            isMobile={isMobile}
            width={width}
            onResize={next => {
                setPreferredWidth(next);
                savePanelWidth(next);
            }}
            status={assistant.status}
            conversation={assistant.conversation}
            conversations={assistant.conversations}
            messages={assistant.messages}
            contextFraction={assistant.contextFraction}
            contextWindow={assistant.contextWindow}
            error={assistant.error}
            sessionExpired={assistant.sessionExpired}
            persistent={assistant.persistent ?? true}
            pageContext={assistant.pageContext}
            detail={settings.display.detail}
            keyboardInset={keyboardInset}
            onSend={(text, attachPageContext) => void assistant.send(text, { attachPageContext })}
            onStop={assistant.stop}
            onRetry={() => void assistant.retry?.()}
            onContinue={() => void assistant.continueTurn?.()}
            onNewChat={assistant.newConversation}
            onOpenConversation={id => void assistant.openConversation(id)}
            onDeleteConversation={id => assistant.deleteConversation(id)}
            onRenameConversation={assistant.renameConversation}
            onClose={shell.close}
            onRestore={shell.open}
            blocked={blocked}
            emptyState={
                <StarterPrompts
                    onSelect={text => void assistant.send(text)}
                    disabled={assistant.status === 'streaming' || assistant.status === 'awaiting-approval'}
                />
            }
        />
    );
}
