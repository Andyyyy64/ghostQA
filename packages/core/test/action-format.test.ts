/**
 * Tests for GitHub Action PR comment formatters.
 * These functions are extracted from packages/action/src/format.ts
 * but tested here since vitest is configured at the core level.
 */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";

// Import directly from action source since it's TypeScript
const formatModule = await import(resolve(import.meta.dirname, "../../action/src/format"));
const { formatComparisonComment, formatSingleRunComment } = formatModule;

describe("GitHub Action formatters", () => {
  describe("formatSingleRunComment", () => {
    it("formats a passing result with no discoveries", () => {
      const body = formatSingleRunComment({
        verdict: "pass",
        discoveries: [],
        cost: { total_usd: 0.15, is_rate_limited: false },
      });

      expect(body).toContain("ghostqa Report");
      expect(body).toContain("PASS");
      expect(body).toContain("$0.15");
      expect(body).toContain("No issues found");
      expect(body).toContain("ghostQA");
    });

    it("formats a failing result with discoveries", () => {
      const body = formatSingleRunComment({
        verdict: "fail",
        discoveries: [
          { title: "Button not clickable", severity: "high", description: "The submit button is hidden behind an overlay" },
          { title: "Console error", severity: "medium", description: "TypeError: Cannot read property of undefined" },
        ],
        cost: { total_usd: 1.23, is_rate_limited: false },
      });

      expect(body).toContain("FAIL");
      expect(body).toContain(":x:");
      expect(body).toContain("$1.23");
      expect(body).toContain("Discoveries (2)");
      expect(body).toContain("[HIGH]");
      expect(body).toContain("Button not clickable");
      expect(body).toContain("[MEDIUM]");
    });

    it("shows rate limited for CLI providers", () => {
      const body = formatSingleRunComment({
        verdict: "pass",
        discoveries: [],
        cost: { total_usd: 0, is_rate_limited: true },
      });

      expect(body).toContain("Rate limited");
      expect(body).not.toContain("$0.00");
    });
  });

  describe("formatComparisonComment", () => {
    it("formats comparison with new and fixed issues", () => {
      const body = formatComparisonComment({
        verdict: "fail",
        cost: { total_usd: 2.50, is_rate_limited: false },
        regressions: {
          new_discoveries: [
            { title: "Form validation broken", severity: "critical", description: "Required fields accept empty input" },
          ],
          fixed_discoveries: [
            { title: "Typo in header" },
          ],
        },
        behavioral: {
          console_errors: { base: 0, head: 3, delta: 3 },
        },
        base: { explorer: { steps_taken: 15, pages_visited: 4 }, discoveries: [] },
        head: { explorer: { steps_taken: 20, pages_visited: 5 }, discoveries: [{}] },
      });

      expect(body).toContain("FAIL");
      expect(body).toContain("$2.50");
      expect(body).toContain("Before / After");
      expect(body).toContain("1 new, 1 fixed");
      expect(body).toContain(":warning: +3");
      expect(body).toContain("New Issues");
      expect(body).toContain("[CRITICAL]");
      expect(body).toContain("Form validation broken");
      expect(body).toContain("Fixed Issues");
      expect(body).toContain("~~Typo in header~~");
    });

    it("formats comparison with no regressions", () => {
      const body = formatComparisonComment({
        verdict: "pass",
        cost: { total_usd: 0.80, is_rate_limited: false },
        regressions: {
          new_discoveries: [],
          fixed_discoveries: [],
        },
        behavioral: {
          console_errors: { base: 1, head: 1, delta: 0 },
        },
        base: { explorer: { steps_taken: 10, pages_visited: 3 }, discoveries: [] },
        head: { explorer: { steps_taken: 12, pages_visited: 3 }, discoveries: [] },
      });

      expect(body).toContain("PASS");
      expect(body).toContain("0 new, 0 fixed");
      expect(body).toContain("OK");
      expect(body).not.toContain("New Issues");
      expect(body).not.toContain("Fixed Issues");
    });
  });

  describe("action.yml inputs", () => {
    it("action.yml has correct input definitions", async () => {
      const { readFile } = await import("node:fs/promises");
      const YAML = await import("yaml");
      const actionYml = await readFile(
        resolve(import.meta.dirname, "../../action/action.yml"),
        "utf-8"
      );
      const action = YAML.parse(actionYml);

      expect(action.name).toBe("ghostQA");
      expect(action.inputs.config).toBeDefined();
      expect(action.inputs.config.default).toBe(".ghostqa.yml");
      expect(action.inputs.base).toBeDefined();
      expect(action.inputs.head).toBeDefined();
      expect(action.inputs.budget).toBeDefined();
      expect(action.inputs.explore).toBeDefined();
      expect(action.inputs.comment).toBeDefined();

      expect(action.outputs.verdict).toBeDefined();
      expect(action.outputs.discoveries).toBeDefined();
      expect(action.outputs["report-path"]).toBeDefined();
      expect(action.outputs.cost).toBeDefined();

      expect(action.runs.using).toBe("node20");
      expect(action.runs.main).toBe("dist/index.js");
    });
  });
});
