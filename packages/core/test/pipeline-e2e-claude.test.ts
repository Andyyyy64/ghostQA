/**
 * Pipeline e2e test — CLI provider (claude).
 *
 * Runs `ghostqa run` against demo-app using `claude` CLI.
 * This is the same as pipeline-e2e.test.ts but explicitly named
 * to clarify it tests the Claude CLI provider path.
 *
 * Requires: `claude` CLI available in PATH
 * Timeout: 5 minutes
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const DEMO_APP = resolve(import.meta.dirname, "../../../examples/demo-app");
const CLI = resolve(import.meta.dirname, "../../cli/dist/index.js");
const CONFIG_PATH = join(DEMO_APP, ".ghostqa.yml");

const hasClaude = (() => {
  try {
    const r = spawnSync("which", ["claude"], { encoding: "utf-8" });
    return r.status === 0;
  } catch {
    return false;
  }
})();

const CLAUDE_CONFIG = `app:
  name: ghostqa-demo-app
  build: "pnpm run build"
  start: "pnpm run dev"
  url: "http://localhost:3000"

ai:
  provider: cli
  cli:
    command: claude
  max_budget_usd: 2

explorer:
  max_steps: 20
  max_duration: 180000

constraints:
  no_payment: true
  allowed_domains:
    - localhost
    - "127.0.0.1"
`;

function extractRunId(output: string): string | null {
  const match = output.match(/Run ID: (run-\w+)/);
  return match ? match[1] : null;
}

describe.skipIf(!hasClaude)("pipeline e2e — claude CLI", { timeout: 300_000 }, () => {
  let runDir: string;
  let originalConfig: string;

  beforeAll(async () => {
    originalConfig = await readFile(CONFIG_PATH, "utf-8");
    await writeFile(CONFIG_PATH, CLAUDE_CONFIG, "utf-8");

    const env = { ...process.env };
    delete env.CLAUDECODE;

    const result = spawnSync("node", [CLI, "run", "--diff", "HEAD~1"], {
      cwd: DEMO_APP,
      env,
      encoding: "utf-8",
      timeout: 280_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const output = (result.stdout ?? "") + (result.stderr ?? "");

    if (result.status !== null && result.status > 1) {
      throw new Error(`Pipeline crashed with exit code ${result.status}:\n${output}`);
    }

    const runId = extractRunId(output);
    if (!runId) {
      throw new Error(`Failed to extract run ID from pipeline output:\n${output}`);
    }
    runDir = join(DEMO_APP, ".ghostqa-runs", runId);
  });

  afterAll(async () => {
    await writeFile(CONFIG_PATH, originalConfig, "utf-8");
    if (runDir) {
      await rm(runDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("summary.json is valid", async () => {
    const raw = await readFile(join(runDir, "summary.json"), "utf-8");
    const summary = JSON.parse(raw);

    expect(summary.run_id).toMatch(/^run-/);
    expect(summary.verdict).toMatch(/^(pass|fail|warn)$/);
    expect(summary.started_at).toBeGreaterThan(0);
    expect(summary.finished_at).toBeGreaterThan(summary.started_at);
    expect(summary.diff_analysis).toBeDefined();
    expect(summary.explorer).toBeDefined();
    expect(summary.cost).toBeDefined();
  });

  it("HTML report exists", async () => {
    const html = await readFile(join(runDir, "report.html"), "utf-8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("ghostQA Report");
  });

  it("cost shows rate-limited (CLI provider)", async () => {
    const raw = await readFile(join(runDir, "summary.json"), "utf-8");
    const summary = JSON.parse(raw);
    expect(summary.cost.is_rate_limited).toBe(true);
  });

  it("explorer visits pages and finds discoveries", async () => {
    const raw = await readFile(join(runDir, "summary.json"), "utf-8");
    const summary = JSON.parse(raw);
    expect(summary.explorer.steps_taken).toBeGreaterThan(0);
    expect(summary.explorer.pages_visited).toBeGreaterThan(0);
    expect(summary.discoveries.length).toBeGreaterThanOrEqual(1);
  });
});
