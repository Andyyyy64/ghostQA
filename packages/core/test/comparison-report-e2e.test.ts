/**
 * Comparison report e2e test.
 *
 * Runs Comparator.compare() with two RunResult objects and verifies:
 * - writeComparisonHtml() generates a valid HTML file
 * - comparison.json is well-formed
 * - Before/After table, regressions, and fixed issues appear in report
 * - Behavioral diff stats are rendered
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Comparator } from "../src/comparator/comparator";
import { Reporter } from "../src/reporter/reporter";
import type { RunResult, Discovery } from "../src/types/discovery";

function makeDiscovery(overrides: Partial<Discovery> = {}): Discovery {
  return {
    id: "d-1",
    source: "explorer",
    severity: "high",
    title: "Test bug",
    description: "A test bug found during exploration",
    url: "http://localhost:3000/page",
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeRunResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    run_id: "run-test",
    verdict: "pass",
    started_at: Date.now() - 60_000,
    finished_at: Date.now(),
    config: {},
    diff_analysis: { summary: "Changed login form", files_changed: 3, impact_areas: 2 },
    explorer: { steps_taken: 15, pages_visited: 4, discoveries: [] },
    cost: { total_usd: 0.5, input_tokens: 2000, output_tokens: 800, is_rate_limited: false },
    discoveries: [],
    ...overrides,
  };
}

describe("comparison report e2e", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ghostqa-comp-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("generates comparison HTML with regressions and fixes", async () => {
    const baseResult = makeRunResult({
      run_id: "run-base",
      discoveries: [
        makeDiscovery({ id: "d-old", title: "Old crash on submit", severity: "critical" }),
      ],
    });
    const headResult = makeRunResult({
      run_id: "run-head",
      discoveries: [
        makeDiscovery({ id: "d-new", title: "New 500 error on save", severity: "high" }),
      ],
    });

    const comparator = new Comparator();
    const comparison = comparator.compare(baseResult, headResult, "main", "feature-branch");

    const reporter = new Reporter(tmpDir);
    const reportPath = await reporter.writeComparisonHtml(comparison);

    const html = await readFile(reportPath, "utf-8");

    // Basic HTML structure
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("ghostQA Comparison Report");
    expect(html).toContain("main");
    expect(html).toContain("feature-branch");

    // Verdict
    expect(html).toContain("FAIL");

    // New issue appears
    expect(html).toContain("New 500 error on save");
    expect(html).toContain("NEW");

    // Fixed issue appears
    expect(html).toContain("Old crash on submit");
    expect(html).toContain("FIXED");
  });

  it("generates comparison HTML with behavioral diff stats", async () => {
    const baseResult = makeRunResult({
      run_id: "run-base",
      discoveries: [
        makeDiscovery({ console_errors: ["Error 1"] }),
      ],
    });
    const headResult = makeRunResult({
      run_id: "run-head",
      discoveries: [
        makeDiscovery({ console_errors: ["Error 1", "Error 2", "Error 3"] }),
      ],
    });

    const comparator = new Comparator();
    const comparison = comparator.compare(baseResult, headResult, "v1.0", "v1.1");

    const reporter = new Reporter(tmpDir);
    const reportPath = await reporter.writeComparisonHtml(comparison);
    const html = await readFile(reportPath, "utf-8");

    // Console error delta should be visible
    expect(html).toContain("Console Errors");
    // 1 → 3 (+2)
    expect(html).toMatch(/1.*→.*3/);
  });

  it("generates PASS verdict when no regressions", async () => {
    const baseResult = makeRunResult({ run_id: "run-base" });
    const headResult = makeRunResult({ run_id: "run-head" });

    const comparator = new Comparator();
    const comparison = comparator.compare(baseResult, headResult, "main", "HEAD");

    expect(comparison.verdict).toBe("pass");

    const reporter = new Reporter(tmpDir);
    const reportPath = await reporter.writeComparisonHtml(comparison);
    const html = await readFile(reportPath, "utf-8");

    expect(html).toContain("PASS");
    expect(html).not.toContain("New Issues");
  });

  it("includes Before/After comparison table with exploration stats", async () => {
    const baseResult = makeRunResult({
      run_id: "run-base",
      explorer: { steps_taken: 15, pages_visited: 4, discoveries: [] },
    });
    const headResult = makeRunResult({
      run_id: "run-head",
      explorer: { steps_taken: 20, pages_visited: 6, discoveries: [] },
    });

    const comparator = new Comparator();
    const comparison = comparator.compare(baseResult, headResult, "main", "HEAD");

    const reporter = new Reporter(tmpDir);
    const reportPath = await reporter.writeComparisonHtml(comparison);
    const html = await readFile(reportPath, "utf-8");

    // Before/After table
    expect(html).toContain("Before / After");
    expect(html).toContain("Exploration Steps");
  });

  it("comparison.json can be written alongside HTML report", async () => {
    const baseResult = makeRunResult({ run_id: "run-base" });
    const headResult = makeRunResult({ run_id: "run-head" });

    const comparator = new Comparator();
    const comparison = comparator.compare(baseResult, headResult, "main", "HEAD");

    // Write comparison JSON like compare-pipeline does
    const jsonPath = join(tmpDir, "comparison.json");
    await writeFile(jsonPath, JSON.stringify(comparison, null, 2), "utf-8");

    const raw = await readFile(jsonPath, "utf-8");
    const parsed = JSON.parse(raw);

    expect(parsed.verdict).toBe("pass");
    expect(parsed.base_ref).toBe("main");
    expect(parsed.head_ref).toBe("HEAD");
    expect(parsed.base.run_id).toBe("run-base");
    expect(parsed.head.run_id).toBe("run-head");
    expect(parsed.regressions.new_discoveries).toHaveLength(0);
    expect(parsed.regressions.fixed_discoveries).toHaveLength(0);
    expect(parsed.behavioral.console_errors).toBeDefined();
    expect(parsed.cost.total_usd).toBeCloseTo(1.0);
  });
});
