import consola from "consola";

// Pricing per million tokens
const PRICING: Record<string, { input: number; output: number }> = {
  "gemini-2.0-flash": { input: 0.10, output: 0.40 },
  "gemini-2.5-flash-preview-05-20": { input: 0.15, output: 0.60 },
  "gemini-2.5-pro-preview-05-06": { input: 1.25, output: 10.0 },
  // CLI provider estimates — use Claude Sonnet pricing as reasonable default
  cli: { input: 3.0, output: 15.0 },
  default: { input: 0.15, output: 0.60 },
};

export class BudgetExceededError extends Error {
  constructor(
    public spent: number,
    public budget: number
  ) {
    super(
      `Budget exceeded: $${spent.toFixed(4)} spent of $${budget.toFixed(2)} budget`
    );
    this.name = "BudgetExceededError";
  }
}

export class CostTracker {
  private inputTokens = 0;
  private outputTokens = 0;
  private model: string;
  private budgetUsd: number;

  constructor(model: string, budgetUsd: number) {
    this.model = model;
    this.budgetUsd = budgetUsd;
  }

  track(inputTokens: number, outputTokens: number): void {
    this.inputTokens += inputTokens;
    this.outputTokens += outputTokens;

    const cost = this.totalCostUsd();
    consola.debug(
      `AI cost: $${cost.toFixed(4)} (${this.inputTokens} in / ${this.outputTokens} out)`
    );
  }

  checkBudget(): void {
    const cost = this.totalCostUsd();
    if (cost >= this.budgetUsd) {
      throw new BudgetExceededError(cost, this.budgetUsd);
    }
  }

  totalCostUsd(): number {
    const pricing = PRICING[this.model] ?? PRICING.default;
    return (
      (this.inputTokens / 1_000_000) * pricing.input +
      (this.outputTokens / 1_000_000) * pricing.output
    );
  }

  summary() {
    return {
      total_usd: this.totalCostUsd(),
      input_tokens: this.inputTokens,
      output_tokens: this.outputTokens,
    };
  }
}
