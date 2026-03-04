/**
 * Full pipeline e2e test.
 *
 * Runs `ghostqa run` against the demo-app fixture and verifies:
 * - Pipeline completes without crashing
 * - summary.json is well-formed
 * - HTML report is generated
 * - Video recording is saved
 * - HAR trace is captured
 * - Screenshots directory exists
 * - Discoveries are reported (demo-app has intentional bugs)
 *
 * Requires: Playwright browsers installed, `claude` CLI available
 * Timeout: 5 minutes (AI exploration takes time)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile, readdir, stat, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const DEMO_APP = resolve(import.meta.dirname, "../../../examples/demo-app");
const CLI = resolve(import.meta.dirname, "../../cli/dist/index.js");

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

describe("pipeline e2e", { timeout: 300_000 }, () => {
  let runDir: string;

  beforeAll(() => {
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const result = spawnSync("node", [CLI, "run", "--diff", "HEAD~1"], {
      cwd: DEMO_APP,
      env,
      encoding: "utf-8",
      timeout: 280_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    // Pipeline should complete (exit 0 = pass, exit 1 = fail verdict)
    if (result.status !== null && result.status > 1) {
      const output = (result.stdout ?? "") + (result.stderr ?? "");
      throw new Error(`Pipeline crashed with exit code ${result.status}:\n${output}`);
    }
  });

  beforeAll(async () => {
    runDir = await findLatestRun(DEMO_APP);
  });

  afterAll(async () => {
    if (runDir) {
      await rm(runDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("summary.json is valid", async () => {
    const summaryPath = join(runDir, "summary.json");
    const raw = await readFile(summaryPath, "utf-8");
    const summary = JSON.parse(raw);

    expect(summary.run_id).toMatch(/^run-/);
    expect(summary.verdict).toMatch(/^(pass|fail|warn)$/);
    expect(summary.started_at).toBeGreaterThan(0);
    expect(summary.finished_at).toBeGreaterThan(summary.started_at);
    expect(summary.diff_analysis).toBeDefined();
    expect(summary.explorer).toBeDefined();
    expect(summary.cost).toBeDefined();
    expect(Array.isArray(summary.discoveries)).toBe(true);
  });

  it("HTML report exists and contains expected structure", async () => {
    const html = await readFile(join(runDir, "report.html"), "utf-8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("ghostQA Report");
    expect(html).toContain("Verdict:");
  });

  it("video recording is saved", async () => {
    const videosDir = join(runDir, "videos");
    const videos = await readdir(videosDir);
    const webmFiles = videos.filter((f) => f.endsWith(".webm"));
    expect(webmFiles.length).toBeGreaterThanOrEqual(1);

    const videoStat = await stat(join(videosDir, webmFiles[0]));
    expect(videoStat.size).toBeGreaterThan(10_000);
  });

  it("HAR trace is captured", async () => {
    const harPath = join(runDir, "traces", "trace.har");
    const harStat = await stat(harPath);
    expect(harStat.size).toBeGreaterThan(100);

    const har = JSON.parse(await readFile(harPath, "utf-8"));
    expect(har.log).toBeDefined();
    expect(har.log.entries.length).toBeGreaterThan(0);
  });

  it("screenshots directory has files", async () => {
    const ssDir = join(runDir, "screenshots");
    const files = await readdir(ssDir);
    expect(files.length).toBeGreaterThan(0);
  });

  it("discovers at least one bug in demo-app", async () => {
    const raw = await readFile(join(runDir, "summary.json"), "utf-8");
    const summary = JSON.parse(raw);
    expect(summary.discoveries.length).toBeGreaterThanOrEqual(1);

    for (const d of summary.discoveries) {
      expect(d.id).toBeTruthy();
      expect(d.severity).toMatch(/^(critical|high|medium|low|info)$/);
      expect(d.title).toBeTruthy();
      expect(d.source).toMatch(/^(explorer|console)$/);
    }
  });

  it("explorer visits pages", async () => {
    const raw = await readFile(join(runDir, "summary.json"), "utf-8");
    const summary = JSON.parse(raw);
    expect(summary.explorer.steps_taken).toBeGreaterThan(0);
    expect(summary.explorer.pages_visited).toBeGreaterThan(0);
  });
});
