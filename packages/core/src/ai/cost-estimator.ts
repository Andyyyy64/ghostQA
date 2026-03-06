import type { GhostQAConfig } from "../types/config";

export interface CostEstimate {
  provider: string;
  model: string;
  is_rate_limited: boolean;
  estimated_steps: number;
  estimated_tokens: { input: number; output: number };
  estimated_cost_usd: { low: number; high: number };
}

// Average tokens per exploration step (empirical from testing)
const AVG_INPUT_TOKENS_PER_STEP = 2500; // AX tree + screenshot description + history
const AVG_OUTPUT_TOKENS_PER_STEP = 300; // JSON action response

// Rough pricing per 1M tokens (as of 2026)
const PRICING: Record<string, { input: number; output: number }> = {
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-1.5-flash": { input: 0.075, output: 0.3 },
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-haiku-3-5-20241022": { input: 0.8, output: 4.0 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

export function estimateCost(
  config: GhostQAConfig,
  diffLinesChanged: number,
): CostEstimate {
  const maxSteps = config.explorer.max_steps;
  // Estimate actual steps: usually 60-80% of max_steps
  const estimatedSteps = Math.round(maxSteps * 0.7);

  const isRateLimited = config.ai.provider === "cli";

  // Diff analysis: ~1 call, 1000-3000 tokens depending on diff size
  const diffTokens = Math.min(diffLinesChanged * 5, 8000);

  const totalInputTokens = estimatedSteps * AVG_INPUT_TOKENS_PER_STEP + diffTokens;
  const totalOutputTokens = estimatedSteps * AVG_OUTPUT_TOKENS_PER_STEP;

  const pricing = PRICING[config.ai.model];
  let lowCost = 0;
  let highCost = 0;

  if (pricing && !isRateLimited) {
    lowCost =
      (totalInputTokens * 0.7 * pricing.input +
        totalOutputTokens * 0.7 * pricing.output) /
      1_000_000;
    highCost =
      (totalInputTokens * 1.3 * pricing.input +
        totalOutputTokens * 1.3 * pricing.output) /
      1_000_000;
  }

  return {
    provider: config.ai.provider,
    model: config.ai.model,
    is_rate_limited: isRateLimited,
    estimated_steps: estimatedSteps,
    estimated_tokens: { input: totalInputTokens, output: totalOutputTokens },
    estimated_cost_usd: {
      low: Math.round(lowCost * 100) / 100,
      high: Math.round(highCost * 100) / 100,
    },
  };
}
