/**
 * Tests for Comparator — Before/After comparison logic.
 */
import { describe, it, expect } from "vitest";
import { Comparator } from "../src/comparator/comparator";
import type { RunResult, Discovery } from "../src/types/discovery";

function makeDiscovery(
  overrides: Partial<Discovery> = {}
): Discovery {
  return {
    id: "d-1",
    source: "layer-b",
    severity: "high",
    title: "Test bug",
    description: "A test bug description",
    url: "http://localhost:3000",
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeRunResult(
  overrides: Partial<RunResult> = {}
): RunResult {
  return {
    run_id: "run-test",
    verdict: "pass",
    started_at: 1000,
    finished_at: 2000,
    config: {},
    diff_analysis: { summary: "test", files_changed: 1, impact_areas: 1 },
    layer_a: {
      tests_generated: 5,
      tests_passed: 5,
      tests_failed: 0,
      discoveries: [],
    },
    layer_b: { steps_taken: 10, pages_visited: 3, discoveries: [] },
    cost: { total_usd: 0.5, input_tokens: 1000, output_tokens: 500, is_rate_limited: false },
    discoveries: [],
    ...overrides,
  };
}

describe("Comparator", () => {
  const comparator = new Comparator();

  it("detects new discoveries as regressions", () => {
    const base = makeRunResult({ discoveries: [] });
    const head = makeRunResult({
      discoveries: [makeDiscovery({ title: "New crash" })],
    });

    const result = comparator.compare(base, head, "main", "HEAD");

    expect(result.regressions.new_discoveries).toHaveLength(1);
    expect(result.regressions.new_discoveries[0].title).toBe("New crash");
    expect(result.regressions.fixed_discoveries).toHaveLength(0);
  });

  it("detects fixed discoveries", () => {
    const base = makeRunResult({
      discoveries: [makeDiscovery({ title: "Old bug" })],
    });
    const head = makeRunResult({ discoveries: [] });

    const result = comparator.compare(base, head, "main", "HEAD");

    expect(result.regressions.fixed_discoveries).toHaveLength(1);
    expect(result.regressions.fixed_discoveries[0].title).toBe("Old bug");
    expect(result.regressions.new_discoveries).toHaveLength(0);
  });

  it("reports no regressions when same discoveries exist", () => {
    const bug = makeDiscovery({ title: "Persistent bug" });
    const base = makeRunResult({ discoveries: [bug] });
    const head = makeRunResult({ discoveries: [bug] });

    const result = comparator.compare(base, head, "main", "HEAD");

    expect(result.regressions.new_discoveries).toHaveLength(0);
    expect(result.regressions.fixed_discoveries).toHaveLength(0);
  });

  it("detects test regressions", () => {
    const base = makeRunResult({
      layer_a: { tests_generated: 5, tests_passed: 5, tests_failed: 0, discoveries: [] },
    });
    const head = makeRunResult({
      layer_a: { tests_generated: 5, tests_passed: 3, tests_failed: 2, discoveries: [] },
    });

    const result = comparator.compare(base, head, "main", "HEAD");

    expect(result.regressions.test_regressions).toBe(2);
    expect(result.regressions.test_fixes).toBe(0);
  });

  it("detects test fixes", () => {
    const base = makeRunResult({
      layer_a: { tests_generated: 5, tests_passed: 3, tests_failed: 2, discoveries: [] },
    });
    const head = makeRunResult({
      layer_a: { tests_generated: 5, tests_passed: 5, tests_failed: 0, discoveries: [] },
    });

    const result = comparator.compare(base, head, "main", "HEAD");

    expect(result.regressions.test_fixes).toBe(2);
    expect(result.regressions.test_regressions).toBe(0);
  });

  it("verdict is FAIL for new critical/high discoveries", () => {
    const base = makeRunResult();
    const head = makeRunResult({
      discoveries: [makeDiscovery({ severity: "critical", title: "crash" })],
    });

    const result = comparator.compare(base, head, "main", "HEAD");
    expect(result.verdict).toBe("fail");
  });

  it("verdict is FAIL for test regressions", () => {
    const base = makeRunResult({
      layer_a: { tests_generated: 5, tests_passed: 5, tests_failed: 0, discoveries: [] },
    });
    const head = makeRunResult({
      layer_a: { tests_generated: 5, tests_passed: 4, tests_failed: 1, discoveries: [] },
    });

    const result = comparator.compare(base, head, "main", "HEAD");
    expect(result.verdict).toBe("fail");
  });

  it("verdict is WARN for new medium discoveries", () => {
    const base = makeRunResult();
    const head = makeRunResult({
      discoveries: [makeDiscovery({ severity: "medium", title: "minor issue" })],
    });

    const result = comparator.compare(base, head, "main", "HEAD");
    expect(result.verdict).toBe("warn");
  });

  it("verdict is PASS when no regressions", () => {
    const base = makeRunResult();
    const head = makeRunResult();

    const result = comparator.compare(base, head, "main", "HEAD");
    expect(result.verdict).toBe("pass");
  });

  it("aggregates costs from both runs", () => {
    const base = makeRunResult({
      cost: { total_usd: 0.5, input_tokens: 1000, output_tokens: 500, is_rate_limited: false },
    });
    const head = makeRunResult({
      cost: { total_usd: 0.7, input_tokens: 1500, output_tokens: 800, is_rate_limited: false },
    });

    const result = comparator.compare(base, head, "main", "HEAD");
    expect(result.cost.total_usd).toBeCloseTo(1.2);
    expect(result.cost.input_tokens).toBe(2500);
    expect(result.cost.output_tokens).toBe(1300);
  });

  it("behavioral diff counts console errors from discoveries", () => {
    const base = makeRunResult({
      discoveries: [
        makeDiscovery({ console_errors: ["Error 1", "Error 2"] }),
      ],
    });
    const head = makeRunResult({
      discoveries: [
        makeDiscovery({ console_errors: ["Error 1", "Error 2", "Error 3", "Error 4"] }),
      ],
    });

    const result = comparator.compare(base, head, "main", "HEAD");
    expect(result.behavioral.console_errors.base).toBe(2);
    expect(result.behavioral.console_errors.head).toBe(4);
    expect(result.behavioral.console_errors.delta).toBe(2);
  });
});
