/**
 * Desktop computer-use pipeline e2e test.
 *
 * Runs `ghostqa run` in desktop mode against demo-app:
 * - Starts Xvfb virtual display + openbox window manager
 * - Pipeline launches Chrome via desktop.app_command
 * - AI explores via xdotool/scrot (generic desktop path with CLI provider)
 * - Verifies summary.json, HTML report, and exploration results
 *
 * Requires: Xvfb, xdotool, scrot, google-chrome, openbox, `claude` CLI
 * Timeout: 5 minutes
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync, spawn, type ChildProcess } from "node:child_process";

const DEMO_APP = resolve(import.meta.dirname, "../../../examples/demo-app");
const CLI = resolve(import.meta.dirname, "../../cli/dist/index.js");
const CONFIG_PATH = join(DEMO_APP, ".ghostqa.yml");

// Use display :42 to avoid conflicts with user's display
const DISPLAY = ":42";

function checkDeps(): boolean {
  const deps = ["Xvfb", "xdotool", "scrot", "google-chrome", "openbox", "claude"];
  for (const dep of deps) {
    const r = spawnSync("which", [dep], { encoding: "utf-8" });
    if (r.status !== 0) return false;
  }
  return true;
}

const hasDeps = checkDeps();

const DESKTOP_CONFIG = `app:
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
  enabled: true
  mode: desktop
  max_steps: 15
  max_duration: 180000
  viewport:
    width: 1280
    height: 720
  desktop:
    display: "${DISPLAY}"
    app_command: "google-chrome --no-sandbox --disable-gpu --window-size=1280,720 --no-first-run --disable-default-apps --disable-session-crashed-bubble --disable-infobars http://localhost:3000"
    window_name: "Todo App"
    window_timeout: 30000

reporter:
  output_dir: .ghostqa-runs
  formats:
    - html
    - json
  video: false
  screenshots: true

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

describe.skipIf(!hasDeps)("pipeline e2e — desktop (computer-use)", { timeout: 360_000 }, () => {
  let runDir: string;
  let originalConfig: string;
  let xvfbProcess: ChildProcess;
  let openboxProcess: ChildProcess;

  beforeAll(async () => {
    // Start Xvfb + openbox
    spawnSync("pkill", ["-f", `Xvfb ${DISPLAY}`], { encoding: "utf-8" });
    await new Promise(r => setTimeout(r, 500));

    xvfbProcess = spawn("Xvfb", [DISPLAY, "-screen", "0", "1280x720x24", "-ac"], {
      stdio: "ignore",
      detached: true,
    });
    xvfbProcess.unref();
    await new Promise(r => setTimeout(r, 1000));

    openboxProcess = spawn("openbox", [], {
      stdio: "ignore",
      detached: true,
      env: { ...process.env, DISPLAY },
    });
    openboxProcess.unref();
    await new Promise(r => setTimeout(r, 500));

    // Save original config, write desktop config
    originalConfig = await readFile(CONFIG_PATH, "utf-8");
    await writeFile(CONFIG_PATH, DESKTOP_CONFIG, "utf-8");

    // Run the pipeline
    const env = { ...process.env, DISPLAY };
    delete env.CLAUDECODE;

    const result = spawnSync("node", [CLI, "run", "--diff", "HEAD~1"], {
      cwd: DEMO_APP,
      env,
      encoding: "utf-8",
      timeout: 340_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const output = (result.stdout ?? "") + (result.stderr ?? "");

    if (result.status !== null && result.status > 1) {
      throw new Error(`Desktop pipeline crashed with exit code ${result.status}:\n${output}`);
    }

    const runId = extractRunId(output);
    if (!runId) {
      throw new Error(`Failed to extract run ID from pipeline output:\n${output}`);
    }
    runDir = join(DEMO_APP, ".ghostqa-runs", runId);
  });

  afterAll(async () => {
    // Restore original config
    await writeFile(CONFIG_PATH, originalConfig, "utf-8");

    // Cleanup run directory
    if (runDir) {
      await rm(runDir, { recursive: true, force: true }).catch(() => {});
    }

    // Stop Xvfb and openbox
    try { openboxProcess?.kill("SIGTERM"); } catch {}
    try { xvfbProcess?.kill("SIGTERM"); } catch {}
    spawnSync("pkill", ["-f", `Xvfb ${DISPLAY}`], { encoding: "utf-8" });
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

  it("explorer took steps via desktop mode", async () => {
    const raw = await readFile(join(runDir, "summary.json"), "utf-8");
    const summary = JSON.parse(raw);
    expect(summary.explorer.steps_taken).toBeGreaterThan(0);
  });

  it("cost shows rate-limited (CLI provider)", async () => {
    const raw = await readFile(join(runDir, "summary.json"), "utf-8");
    const summary = JSON.parse(raw);
    expect(summary.cost.is_rate_limited).toBe(true);
  });
});
