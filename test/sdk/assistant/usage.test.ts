import { addUsage, computeCost, EMPTY_USAGE_TOTALS, type TurnUsage } from '@/lib/core/entity/assistant/usage';
import { DEFAULT_ASSISTANT_CONFIG } from '@/lib/core/entity/assistant/assistant-config';

const turn = (overrides: Partial<TurnUsage> = {}): TurnUsage => ({
    inputTokens: 1000,
    outputTokens: 200,
    costUSD: 0.01,
    durationMs: 1500,
    ...overrides,
});

describe('computeCost', () => {
    it('returns null when no pricing is known', () => {
        expect(computeCost({ inputTokens: 10, outputTokens: 10 }, undefined)).toBeNull();
    });

    it('prices input and output per million tokens', () => {
        expect(computeCost({ inputTokens: 1_000_000, outputTokens: 500_000 }, { inputPerMTok: 3, outputPerMTok: 15 })).toBeCloseTo(10.5, 10);
    });

    it('bills cached input at the cached rate', () => {
        const cost = computeCost(
            { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 400_000 },
            { inputPerMTok: 3, outputPerMTok: 15, cachedInputPerMTok: 0.3 },
        );
        expect(cost).toBeCloseTo(1.92, 10);
    });

    it('bills cached input at the input rate when no cached rate is known', () => {
        const cost = computeCost({ inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 400_000 }, { inputPerMTok: 3, outputPerMTok: 15 });
        expect(cost).toBeCloseTo(3, 10);
    });

    it('never counts more cached tokens than input tokens', () => {
        const cost = computeCost(
            { inputTokens: 100, outputTokens: 0, cachedInputTokens: 500 },
            { inputPerMTok: 1, outputPerMTok: 1, cachedInputPerMTok: 0 },
        );
        expect(cost).toBe(0);
    });

    it('returns zero for zero usage when pricing is known', () => {
        expect(computeCost({ inputTokens: 0, outputTokens: 0 }, { inputPerMTok: 3, outputPerMTok: 15 })).toBe(0);
    });
});

describe('addUsage', () => {
    it('adds tokens and counts turns', () => {
        expect(addUsage(EMPTY_USAGE_TOTALS, turn({ cachedInputTokens: 300 }))).toEqual({
            inputTokens: 1000,
            outputTokens: 200,
            cachedInputTokens: 300,
            costUSD: 0.01,
            turns: 1,
        });
    });

    it('keeps the cost null while every turn is unpriced', () => {
        const totals = addUsage(addUsage(EMPTY_USAGE_TOTALS, turn({ costUSD: null })), turn({ costUSD: null }));
        expect(totals.costUSD).toBeNull();
        expect(totals.turns).toBe(2);
    });

    it('sums known costs and skips unknown ones', () => {
        const totals = [turn({ costUSD: null }), turn({ costUSD: 0.02 }), turn({ costUSD: null }), turn({ costUSD: 0.03 })].reduce(
            (acc, t) => addUsage(acc, t),
            EMPTY_USAGE_TOTALS,
        );
        expect(totals.costUSD).toBeCloseTo(0.05, 10);
        expect(totals.turns).toBe(4);
        expect(totals.inputTokens).toBe(4000);
    });

    it('does not mutate the totals it is given', () => {
        const before = { ...EMPTY_USAGE_TOTALS };
        addUsage(EMPTY_USAGE_TOTALS, turn());
        expect(EMPTY_USAGE_TOTALS).toEqual(before);
    });
});

describe('DEFAULT_ASSISTANT_CONFIG', () => {
    it('asks before writes and high-risk calls, allows BYOK and exports nothing', () => {
        expect(DEFAULT_ASSISTANT_CONFIG).toEqual({
            writePolicyCap: 'ask',
            highRiskPolicyCap: 'ask',
            allowByok: true,
            allowedProviderKinds: ['anthropic', 'openai', 'openai-compatible', 'ollama'],
            telemetry: { operatorSink: false, allowUserSinks: true, contentCap: 'metadata', hashUser: false },
            operatorSkills: [],
        });
    });
});
