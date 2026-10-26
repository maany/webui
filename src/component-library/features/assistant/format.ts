import type { ChatMessage } from '@/lib/core/entity/assistant/conversation';

export function formatTokens(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
    return String(tokens);
}

export function formatCost(costUSD: number | null | undefined): string | undefined {
    if (costUSD === null || costUSD === undefined) return undefined;
    if (costUSD > 0 && costUSD < 0.01) return '<$0.01';
    return `$${costUSD.toFixed(2)}`;
}

export function formatDuration(ms: number): string {
    return ms < 1_000 ? `${ms} ms` : `${Math.round(ms / 1_000)}s`;
}

export function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} kB`;
    return `${bytes} B`;
}

export interface ActivitySummary {
    reasoningMs?: number;
    hasReasoning: boolean;
    toolCount: number;
    inputTokens?: number;
    outputTokens?: number;
    cost?: string;
}

export function summarizeActivity(message: ChatMessage): ActivitySummary {
    let reasoningMs: number | undefined;
    let hasReasoning = false;
    let toolCount = 0;
    for (const part of message.parts) {
        if (part.type === 'reasoning') {
            hasReasoning = true;
            if (part.durationMs !== undefined) reasoningMs = (reasoningMs ?? 0) + part.durationMs;
        }
        if (part.type === 'tool-call') toolCount += 1;
    }
    return {
        hasReasoning,
        toolCount,
        ...(reasoningMs !== undefined ? { reasoningMs } : {}),
        ...(message.usage
            ? { inputTokens: message.usage.inputTokens, outputTokens: message.usage.outputTokens, cost: formatCost(message.usage.costUSD) }
            : {}),
    };
}

/** "Thought 4s · 3 tools · 12.4k / 0.8k tok · $0.04" */
export function activityLabel(summary: ActivitySummary): string {
    const pieces: string[] = [];
    if (summary.hasReasoning) pieces.push(summary.reasoningMs !== undefined ? `Thought ${formatDuration(summary.reasoningMs)}` : 'Thought');
    if (summary.toolCount > 0) pieces.push(`${summary.toolCount} ${summary.toolCount === 1 ? 'tool' : 'tools'}`);
    if (summary.inputTokens !== undefined && summary.outputTokens !== undefined)
        pieces.push(`${formatTokens(summary.inputTokens)} / ${formatTokens(summary.outputTokens)} tok`);
    if (summary.cost) pieces.push(summary.cost);
    return pieces.join(' · ');
}
