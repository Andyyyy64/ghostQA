/**
 * Compare pipeline e2e test.
 *
 * Runs `ghostqa run --base HEAD~1` against the demo-app and verifies:
 * - Pipeline completes without crashing
 * - comparison.json is generated with expected structure
 * - Comparison HTML report has before/after sections
 * - Two separate run directories are created (base + head)
 *
 * Requires: Playwright browsers installed, AI provider available
 * Timeout: 10 minutes (runs pipeline twice)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const DEMO_APP = resolve(import.meta.dirname, "../../../examples/demo-app");
const CLI = resolve(import.meta.dirname, "../../cli/dist/index.js");

function extractRunId(output: string): string | null {
  // Compare pipeline logs the comparison run ID (last one logged)
  const matches = output.match(/Run ID: (run-\w+)/g);
  if (!matches || matches.length === 0) return null;
  const last = matches[matches.length - 1];
  return last.match(/Run ID: (run-\w+)/)?.[1] ?? null;
}

describe("compare pipeline e2e", { timeout: 600_000 }, () => {
  let runDir: string;

  beforeAll(() => {
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const result = spawnSync(
      "node",
      [CLI, "run", "--base", "HEAD~1", "--head", "HEAD"],
      {
        cwd: DEMO_APP,
        env,
        encoding: "utf-8",
        timeout: 580_000,
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    const output = (result.stdout ?? "") + (result.stderr ?? "");

    if (result.status !== null && result.status > 1) {
      throw new Error(
        `Compare pipeline crashed with exit code ${result.status}:\n${output}`
      );
    }

    const runId = extractRunId(output);
    if (!runId) {
      throw new Error(`Failed to extract run ID from pipeline output:\n${output}`);
    }
    runDir = join(DEMO_APP, ".ghostqa-runs", runId);
  });

  afterAll(async () => {
    // Clean up all run dirs created during this test
    try {
      const runsDir = join(DEMO_APP, ".ghostqa-runs");
      const entries = await readdir(runsDir);
      for (const entry of entries) {
        if (entry.startsWith("run-")) {
          await rm(join(runsDir, entry), { recursive: true, force: true }).catch(() => {});
        }
      }
    } catch {}
  });

  it("comparison.json exists and has expected structure", async () => {
    const compPath = join(runDir, "comparison.json");
    const raw = await readFile(compPath, "utf-8");
    const comp = JSON.parse(raw);

    expect(comp.verdict).toMatch(/^(pass|fail|warn)$/);
    expect(comp.base_ref).toBeTruthy();
    expect(comp.head_ref).toBeTruthy();
    expect(comp.base).toBeDefined();
    expect(comp.head).toBeDefined();
    expect(comp.base.run_id).toMatch(/^run-/);
    expect(comp.head.run_id).toMatch(/^run-/);
    expect(comp.regressions).toBeDefined();
    expect(Array.isArray(comp.regressions.new_discoveries)).toBe(true);
    expect(Array.isArray(comp.regressions.fixed_discoveries)).toBe(true);
    expect(comp.behavioral).toBeDefined();
    expect(comp.behavioral.console_errors).toBeDefined();
    expect(comp.cost).toBeDefined();
    expect(comp.cost.total_usd).toBeGreaterThanOrEqual(0);
  });

  it("comparison HTML report exists with before/after content", async () => {
    const html = await readFile(join(runDir, "report.html"), "utf-8");

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("ghostQA Comparison Report");
    expect(html).toContain("Before / After");
    expect(html).toContain("Exploration Steps");
    expect(html).toContain("Verdict:");
  });

  it("both base and head run directories exist", async () => {
    const compRaw = await readFile(join(runDir, "comparison.json"), "utf-8");
    const comp = JSON.parse(compRaw);

    const runsDir = join(DEMO_APP, ".ghostqa-runs");

    // Base run dir should exist
    const baseRunDir = join(runsDir, comp.base.run_id);
    const baseStat = await stat(baseRunDir);
    expect(baseStat.isDirectory()).toBe(true);

    // Head run dir should exist
    const headRunDir = join(runsDir, comp.head.run_id);
    const headStat = await stat(headRunDir);
    expect(headStat.isDirectory()).toBe(true);
  });

  it("base and head have separate summary.json files", async () => {
    const compRaw = await readFile(join(runDir, "comparison.json"), "utf-8");
    const comp = JSON.parse(compRaw);
    const runsDir = join(DEMO_APP, ".ghostqa-runs");

    const baseSummary = JSON.parse(
      await readFile(join(runsDir, comp.base.run_id, "summary.json"), "utf-8")
    );
    const headSummary = JSON.parse(
      await readFile(join(runsDir, comp.head.run_id, "summary.json"), "utf-8")
    );

    // Both should be valid RunResults
    expect(baseSummary.run_id).toBe(comp.base.run_id);
    expect(headSummary.run_id).toBe(comp.head.run_id);
    expect(baseSummary.run_id).not.toBe(headSummary.run_id);
  });

  it("behavioral diff includes console error stats", async () => {
    const compRaw = await readFile(join(runDir, "comparison.json"), "utf-8");
    const comp = JSON.parse(compRaw);

    expect(typeof comp.behavioral.console_errors.base).toBe("number");
    expect(typeof comp.behavioral.console_errors.head).toBe("number");
    expect(typeof comp.behavioral.console_errors.delta).toBe("number");
    expect(comp.behavioral.console_errors.delta).toBe(
      comp.behavioral.console_errors.head - comp.behavioral.console_errors.base
    );
  });
});
