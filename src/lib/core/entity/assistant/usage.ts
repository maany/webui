import type { ModelPricing } from './provider-config';

export interface TokenUsage {
    /** Total prompt tokens INCLUDING cachedInputTokens. Runners normalise providers that report cache reads separately. */
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
}

export interface TurnUsage extends TokenUsage {
    costUSD: number | null; // null when no pricing is known
    durationMs: number;
}

export interface UsageTotals extends TokenUsage {
    costUSD: number | null; // null if any priced component unknown and none known; see addUsage
    turns: number;
}

export const EMPTY_USAGE_TOTALS: UsageTotals = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUSD: null, turns: 0 };

const TOKENS_PER_MILLION = 1_000_000;

/** Cost in USD, or null when pricing is undefined. Cached input billed at cachedInputPerMTok when given, else inputPerMTok. */
export function computeCost(usage: TokenUsage, pricing: ModelPricing | undefined): number | null {
    if (!pricing) return null;
    const cached = Math.min(Math.max(usage.cachedInputTokens ?? 0, 0), Math.max(usage.inputTokens, 0));
    const uncached = Math.max(usage.inputTokens - cached, 0);
    const cachedRate = pricing.cachedInputPerMTok ?? pricing.inputPerMTok;
    const output = Math.max(usage.outputTokens, 0);
    return (uncached * pricing.inputPerMTok + cached * cachedRate + output * pricing.outputPerMTok) / TOKENS_PER_MILLION;
}

/** Sums usage; costUSD is the sum of known costs, null only when every turn's cost is null. */
export function addUsage(totals: UsageTotals, turn: TurnUsage): UsageTotals {
    return {
        inputTokens: totals.inputTokens + turn.inputTokens,
        outputTokens: totals.outputTokens + turn.outputTokens,
        cachedInputTokens: (totals.cachedInputTokens ?? 0) + (turn.cachedInputTokens ?? 0),
        costUSD: turn.costUSD === null ? totals.costUSD : (totals.costUSD ?? 0) + turn.costUSD,
        turns: totals.turns + 1,
    };
}
