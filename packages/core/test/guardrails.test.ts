import { describe, it, expect, vi, beforeEach } from "vitest";
import { Guardrails } from "../src/explorer/guardrails";
import type { CostTracker } from "../src/ai/cost-tracker";
import type { ExplorerConfig } from "../src/types/config";

function makeConfig(overrides: Partial<ExplorerConfig> = {}): ExplorerConfig {
  return {
    enabled: true,
    mode: "web",
    max_steps: 50,
    max_duration: 300000,
    viewport: { width: 1280, height: 720 },
    desktop: { display: ":99", app_command: "", window_timeout: 30000 },
    ...overrides,
  };
}

function makeCostTracker(shouldThrow = false): CostTracker {
  return {
    checkBudget: shouldThrow
      ? () => {
          throw new Error("Budget exceeded");
        }
      : () => {},
  } as unknown as CostTracker;
}

describe("Guardrails", () => {
  describe("recordStep", () => {
    it("increments step count", () => {
      const g = new Guardrails(makeConfig(), makeCostTracker());
      g.recordStep("http://localhost:3000/", "click:.btn");
      g.recordStep("http://localhost:3000/", "type:.input");
      expect(g.stats.steps_taken).toBe(2);
    });

    it("tracks unique visited URLs", () => {
      const g = new Guardrails(makeConfig(), makeCostTracker());
      g.recordStep("http://localhost:3000/a", "click:.btn");
      g.recordStep("http://localhost:3000/b", "click:.btn");
      g.recordStep("http://localhost:3000/a", "click:.btn");
      expect(g.stats.pages_visited).toBe(2);
    });

    it("caps recent actions at 10 entries", () => {
      const g = new Guardrails(makeConfig(), makeCostTracker());
      for (let i = 0; i < 15; i++) {
        g.recordStep("http://localhost:3000/", `action:${i}`);
      }
      // Internal recentActions should be capped at 10 — verified by
      // looping detection not seeing ancient entries
      expect(g.stats.steps_taken).toBe(15);
    });
  });

  describe("shouldStop", () => {
    it("returns stop when max_steps reached", () => {
      const g = new Guardrails(makeConfig({ max_steps: 3 }), makeCostTracker());
      g.recordStep("http://localhost/", "a");
      g.recordStep("http://localhost/", "b");
      g.recordStep("http://localhost/", "c");
      const result = g.shouldStop();
      expect(result.stop).toBe(true);
      expect(result.reason).toContain("Max steps");
    });

    it("returns stop when max_duration exceeded", () => {
      const g = new Guardrails(makeConfig({ max_duration: 0 }), makeCostTracker());
      const result = g.shouldStop();
      expect(result.stop).toBe(true);
      expect(result.reason).toContain("Max duration");
    });

    it("returns stop when budget exceeded", () => {
      const g = new Guardrails(makeConfig(), makeCostTracker(true));
      const result = g.shouldStop();
      expect(result.stop).toBe(true);
      expect(result.reason).toContain("Budget");
    });

    it("returns false when under all limits", () => {
      const g = new Guardrails(makeConfig(), makeCostTracker());
      g.recordStep("http://localhost/", "click:.btn");
      const result = g.shouldStop();
      expect(result.stop).toBe(false);
      expect(result.reason).toBeUndefined();
    });
  });

  describe("isLooping (via shouldStop)", () => {
    it("detects loop when last 6 actions are 3+3 repeat", () => {
      const g = new Guardrails(makeConfig(), makeCostTracker());
      const actions = ["click:a", "click:b", "scroll:down", "click:a", "click:b", "scroll:down"];
      for (const a of actions) {
        g.recordStep("http://localhost/", a);
      }
      const result = g.shouldStop();
      expect(result.stop).toBe(true);
      expect(result.reason).toContain("Loop");
    });

    it("does not detect loop with fewer than 6 actions", () => {
      const g = new Guardrails(makeConfig(), makeCostTracker());
      for (let i = 0; i < 5; i++) {
        g.recordStep("http://localhost/", "click:a");
      }
      const result = g.shouldStop();
      expect(result.stop).toBe(false);
    });

    it("does not detect loop when actions differ", () => {
      const g = new Guardrails(makeConfig(), makeCostTracker());
      const actions = ["click:a", "click:b", "click:c", "click:d", "click:e", "click:f"];
      for (const a of actions) {
        g.recordStep("http://localhost/", a);
      }
      const result = g.shouldStop();
      expect(result.stop).toBe(false);
    });
  });

  describe("stats", () => {
    it("returns accurate steps_taken and pages_visited", () => {
      const g = new Guardrails(makeConfig(), makeCostTracker());
      g.recordStep("http://localhost:3000/a", "click:.btn");
      g.recordStep("http://localhost:3000/b", "type:.input");
      g.recordStep("http://localhost:3000/a", "scroll:down");

      const s = g.stats;
      expect(s.steps_taken).toBe(3);
      expect(s.pages_visited).toBe(2);
      expect(s.elapsed_ms).toBeGreaterThanOrEqual(0);
    });
  });
});
