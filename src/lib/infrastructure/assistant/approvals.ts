import { isInvalidArgsMarker } from './tanstack-tools';

/** What the approval card shows instead of a sensitive argument value (ToolSpec.sensitiveArgs). */
export const SENSITIVE_PLACEHOLDER = '[hidden]';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Replaces the values of top-level sensitive keys (for example a password) before args are shown, stored or emitted.
 * An invalid-args marker carries what the model sent, so its received args are masked the same way.
 */
export function maskSensitiveArgs(args: unknown, keys: readonly string[]): unknown {
    if (!isRecord(args) || keys.length === 0) return args;
    if (isInvalidArgsMarker(args)) {
        const inner = (args as Record<string, { message: string; received: unknown }>).__rucio_invalid_args;
        return { ...args, __rucio_invalid_args: { ...inner, received: maskSensitiveArgs(inner.received, keys) } };
    }
    const copy: Record<string, unknown> = { ...args };
    for (const key of keys) {
        if (copy[key] !== undefined) copy[key] = SENSITIVE_PLACEHOLDER;
    }
    return copy;
}
