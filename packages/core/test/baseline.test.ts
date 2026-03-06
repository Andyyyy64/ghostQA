import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  saveBaseline,
  loadBaseline,
  listBaselines,
  clearBaseline,
} from "../src/baseline/manager";

const FAKE_SUMMARY = {
  run_id: "ghostqa-test-abc123",
  verdict: "pass",
  started_at: 1000,
  finished_at: 2000,
  config: {},
  diff_analysis: { summary: "test", files_changed: 1, impact_areas: 1 },
  explorer: { steps_taken: 5, pages_visited: 2, discoveries: [] },
  cost: {
    total_usd: 0.5,
    input_tokens: 100,
    output_tokens: 50,
    is_rate_limited: false,
  },
  discoveries: [],
};

describe("baseline manager", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  async function setupFakeRun(cwd: string, runId: string) {
    const runsDir = join(cwd, ".ghostqa-runs", runId);
    await mkdir(runsDir, { recursive: true });
    await writeFile(
      join(runsDir, "summary.json"),
      JSON.stringify({ ...FAKE_SUMMARY, run_id: runId }),
      "utf-8"
    );
    return runsDir;
  }

  it("saveBaseline + loadBaseline round-trip", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ghostqa-baseline-test-"));
    const runId = "ghostqa-test-abc123";
    await setupFakeRun(tmpDir, runId);

    const dest = await saveBaseline(tmpDir, runId);
    expect(dest).toContain(runId);

    const loaded = await loadBaseline(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.run_id).toBe(runId);
    expect(loaded!.verdict).toBe("pass");
    expect(loaded!.discoveries).toEqual([]);
  });

  it("loadBaseline returns null when no baseline exists", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ghostqa-baseline-test-"));
    const loaded = await loadBaseline(tmpDir);
    expect(loaded).toBeNull();
  });

  it("listBaselines returns empty when no baseline", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ghostqa-baseline-test-"));
    const baselines = await listBaselines(tmpDir);
    expect(baselines).toEqual([]);
  });

  it("listBaselines returns saved baseline", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ghostqa-baseline-test-"));
    const runId = "ghostqa-test-list";
    await setupFakeRun(tmpDir, runId);
    await saveBaseline(tmpDir, runId);

    const baselines = await listBaselines(tmpDir);
    expect(baselines).toHaveLength(1);
    expect(baselines[0].run_id).toBe(runId);
    expect(baselines[0].verdict).toBe("pass");
    expect(baselines[0].discoveries_count).toBe(0);
    expect(baselines[0].saved_at).toBeTruthy();
  });

  it("clearBaseline removes the baseline directory", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ghostqa-baseline-test-"));
    const runId = "ghostqa-test-clear";
    await setupFakeRun(tmpDir, runId);
    await saveBaseline(tmpDir, runId);

    // Verify baseline exists
    const before = await loadBaseline(tmpDir);
    expect(before).not.toBeNull();

    // Clear it
    await clearBaseline(tmpDir);

    // Should be gone
    const after = await loadBaseline(tmpDir);
    expect(after).toBeNull();
    const list = await listBaselines(tmpDir);
    expect(list).toEqual([]);
  });

  it("clearBaseline succeeds even when no baseline exists", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ghostqa-baseline-test-"));
    // Should not throw
    await clearBaseline(tmpDir);
    const loaded = await loadBaseline(tmpDir);
    expect(loaded).toBeNull();
  });

  it("saveBaseline throws when run does not exist", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ghostqa-baseline-test-"));
    await expect(
      saveBaseline(tmpDir, "nonexistent-run-id")
    ).rejects.toThrow();
  });

  it("saveBaseline overwrites previous baseline", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ghostqa-baseline-test-"));

    const runId1 = "ghostqa-test-first";
    const runId2 = "ghostqa-test-second";
    await setupFakeRun(tmpDir, runId1);
    await setupFakeRun(tmpDir, runId2);

    await saveBaseline(tmpDir, runId1);
    const first = await loadBaseline(tmpDir);
    expect(first!.run_id).toBe(runId1);

    await saveBaseline(tmpDir, runId2);
    const second = await loadBaseline(tmpDir);
    expect(second!.run_id).toBe(runId2);
  });

  it("saveBaseline copies summary.json correctly", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ghostqa-baseline-test-"));
    const runId = "ghostqa-test-copy";
    await setupFakeRun(tmpDir, runId);

    const dest = await saveBaseline(tmpDir, runId);

    // Verify the copied summary.json content matches
    const copiedRaw = await readFile(join(dest, "summary.json"), "utf-8");
    const copied = JSON.parse(copiedRaw);
    expect(copied.run_id).toBe(runId);
    expect(copied.verdict).toBe("pass");

    // Verify current.json metadata
    const metaRaw = await readFile(
      join(tmpDir, ".ghostqa-baseline", "current.json"),
      "utf-8"
    );
    const meta = JSON.parse(metaRaw);
    expect(meta.run_id).toBe(runId);
    expect(meta.verdict).toBe("pass");
    expect(meta.discoveries_count).toBe(0);
    expect(meta.summary_path).toContain("summary.json");
  });
});
