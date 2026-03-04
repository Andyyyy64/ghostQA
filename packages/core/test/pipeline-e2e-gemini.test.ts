/**
 * Pipeline e2e test — Gemini API provider.
 *
 * Runs `ghostqa run` against demo-app using Gemini API.
 *
 * Requires: GEMINI_API_KEY environment variable (or in project root .env)
 * Timeout: 5 minutes
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile, readdir, stat, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const DEMO_APP = resolve(import.meta.dirname, "../../../examples/demo-app");
const CLI = resolve(import.meta.dirname, "../../cli/dist/index.js");
const CONFIG_PATH = join(DEMO_APP, ".ghostqa.yml");
const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");

function loadGeminiKey(): string | undefined {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  try {
    const envPath = join(PROJECT_ROOT, ".env");
    const content = readFileSync(envPath, "utf-8");
    const match = content.match(/^GEMINI_API_KEY=(.+)$/m);
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
}

const GEMINI_KEY = loadGeminiKey();

const GEMINI_CONFIG = `app:
  name: ghostqa-demo-app
  build: "pnpm run build"
  start: "pnpm run dev"
  url: "http://localhost:3000"

ai:
  provider: gemini
  model: gemini-3.1-flash-lite-preview
  api_key_env: GEMINI_API_KEY
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

async function findLatestRun(baseDir: string): Promise<string> {
  const runsDir = join(baseDir, ".ghostqa-runs");
  const entries = await readdir(runsDir);
  const runDirs = entries.filter((e) => e.startsWith("run-"));
  if (runDirs.length === 0) throw new Error("No run directories found");

  const withStats = await Promise.all(
    runDirs.map(async (d) => ({
      name: d,
      mtime: (await stat(join(runsDir, d))).mtimeMs,
    }))
  );
  withStats.sort((a, b) => b.mtime - a.mtime);
  return join(runsDir, withStats[0].name);
}

describe.skipIf(!GEMINI_KEY)("pipeline e2e — Gemini API", { timeout: 300_000 }, () => {
  let runDir: string;
  let originalConfig: string;

  beforeAll(async () => {
    originalConfig = await readFile(CONFIG_PATH, "utf-8");
    await writeFile(CONFIG_PATH, GEMINI_CONFIG, "utf-8");
  });

  beforeAll(() => {
    const env = {
      ...process.env,
      GEMINI_API_KEY: GEMINI_KEY,
    };
    delete env.CLAUDECODE;

    const result = spawnSync("node", [CLI, "run", "--diff", "HEAD~1"], {
      cwd: DEMO_APP,
      env,
      encoding: "utf-8",
      timeout: 280_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.status !== null && result.status > 1) {
      const output = (result.stdout ?? "") + (result.stderr ?? "");
      throw new Error(`Pipeline crashed with exit code ${result.status}:\n${output}`);
    }
  });

  beforeAll(async () => {
    runDir = await findLatestRun(DEMO_APP);
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

  it("cost shows real USD (API provider, not rate-limited)", async () => {
    const raw = await readFile(join(runDir, "summary.json"), "utf-8");
    const summary = JSON.parse(raw);
    expect(summary.cost.is_rate_limited).toBe(false);
    expect(summary.cost.total_usd).toBeGreaterThan(0);
  });

  it("explorer visits pages and finds discoveries", async () => {
    const raw = await readFile(join(runDir, "summary.json"), "utf-8");
    const summary = JSON.parse(raw);
    expect(summary.explorer.steps_taken).toBeGreaterThan(0);
    expect(summary.explorer.pages_visited).toBeGreaterThan(0);
    expect(summary.discoveries.length).toBeGreaterThanOrEqual(1);
  });
});
