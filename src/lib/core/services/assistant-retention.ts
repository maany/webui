import type { RetentionSettings } from '@/lib/core/entity/assistant/settings';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionCandidate {
    id: string;
    updatedAt: string; // ISO
    bytes: number;
}

/** UTF-8 byte length of a string, without depending on browser APIs. */
export function utf8Length(text: string): number {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 0x80) bytes += 1;
        else if (code < 0x800) bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff) {
            bytes += 4;
            i++;
        } else bytes += 3;
    }
    return bytes;
}

/** Approximate stored size of a JSON-serializable record. */
export function jsonBytes(value: unknown): number {
    try {
        return utf8Length(JSON.stringify(value) ?? '');
    } catch {
        return 0;
    }
}

/**
 * Conversations to delete: everything older than maxAgeDays, then the oldest
 * remaining ones until the total fits in maxTotalMB. Protected ids (the open
 * conversation) are never evicted but still count toward the total. A limit of 0 disables it.
 */
export function selectConversationsToEvict(
    candidates: RetentionCandidate[],
    policy: RetentionSettings,
    now: Date,
    protectedIds: readonly string[] = [],
): string[] {
    const evicted = new Set<string>();
    const isProtected = new Set(protectedIds);
    if (policy.maxAgeDays > 0) {
        const cutoff = now.getTime() - policy.maxAgeDays * DAY_MS;
        for (const candidate of candidates) {
            if (!isProtected.has(candidate.id) && Date.parse(candidate.updatedAt) < cutoff) evicted.add(candidate.id);
        }
    }
    if (policy.maxTotalMB > 0) {
        const limit = policy.maxTotalMB * 1024 * 1024;
        const remaining = candidates.filter(candidate => !evicted.has(candidate.id)).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
        let total = remaining.reduce((sum, candidate) => sum + candidate.bytes, 0);
        for (const candidate of remaining) {
            if (total <= limit) break;
            if (isProtected.has(candidate.id)) continue;
            evicted.add(candidate.id);
            total -= candidate.bytes;
        }
    }
    return Array.from(evicted);
}
