'use client';

import { createContext, useContext } from 'react';

/**
 * Whether the Rucio session is usable. `reauth-required` while the in-place re-auth dialog is open,
 * `signed-out` once the monitor decided the session is gone. Features that act on the user's behalf
 * (Rucio bot) block themselves while it is not `active`.
 */
export type SessionGateStatus = 'active' | 'reauth-required' | 'signed-out';

export interface SessionGateValue {
    status: SessionGateStatus;
}

const ACTIVE_GATE: SessionGateValue = { status: 'active' };

export const SessionGateContext = createContext<SessionGateValue>(ACTIVE_GATE);

/** Session gate. Outside a SessionMonitorProvider it is always `active`. */
export function useSessionGate(): SessionGateValue {
    return useContext(SessionGateContext);
}
