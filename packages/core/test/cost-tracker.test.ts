import { describe, it, expect } from "vitest";
import { CostTracker, BudgetExceededError } from "../src/ai/cost-tracker";

describe("CostTracker", () => {
  it("starts with zero cost", () => {
    const tracker = new CostTracker("gemini-2.0-flash", 1.0);
    const summary = tracker.summary();
    expect(summary.total_usd).toBe(0);
    expect(summary.input_tokens).toBe(0);
    expect(summary.output_tokens).toBe(0);
  });

  it("tracks token usage", () => {
    const tracker = new CostTracker("gemini-2.0-flash", 1.0);
    tracker.track(1000, 500);
    const summary = tracker.summary();
    expect(summary.input_tokens).toBe(1000);
    expect(summary.output_tokens).toBe(500);
    expect(summary.total_usd).toBeGreaterThan(0);
  });

  it("accumulates across multiple calls", () => {
    const tracker = new CostTracker("gemini-2.0-flash", 5.0);
    tracker.track(1000, 500);
    tracker.track(2000, 1000);
    const summary = tracker.summary();
    expect(summary.input_tokens).toBe(3000);
    expect(summary.output_tokens).toBe(1500);
  });

  it("throws BudgetExceededError when over budget", () => {
    const tracker = new CostTracker("gemini-2.0-flash", 0.001);
    tracker.track(1_000_000, 500_000);
    expect(() => tracker.checkBudget()).toThrow(BudgetExceededError);
  });

  it("does not throw when within budget", () => {
    const tracker = new CostTracker("gemini-2.0-flash", 100.0);
    tracker.track(100, 50);
    expect(() => tracker.checkBudget()).not.toThrow();
  });

  it("tracks reported cost from CLI providers", () => {
    const tracker = new CostTracker("gemini-2.0-flash", 5.0);
    tracker.addReportedCost(0.5);
    tracker.addReportedCost(0.3);
    const summary = tracker.summary();
    expect(summary.total_usd).toBeCloseTo(0.8, 2);
  });

  it("reports rate limit status", () => {
    const tracker = new CostTracker("gemini-2.0-flash", 1.0);
    expect(tracker.summary().is_rate_limited).toBe(false);
    tracker.isRateLimited = true;
    expect(tracker.summary().is_rate_limited).toBe(true);
  });
});
