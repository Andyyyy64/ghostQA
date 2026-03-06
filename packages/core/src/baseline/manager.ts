import { readFile, writeFile, mkdir, rm, cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import consola from "consola";
import type { RunResult } from "../types/discovery";

const BASELINE_DIR = ".ghostqa-baseline";

export interface SavedBaseline {
  run_id: string;
  saved_at: string;
  verdict: string;
  discoveries_count: number;
  summary_path: string;
}

export async function saveBaseline(
  cwd: string,
  runId: string
): Promise<string> {
  const runsDir = resolve(cwd, ".ghostqa-runs");
  const sourceDir = join(runsDir, runId);
  const baselineDir = resolve(cwd, BASELINE_DIR);

  // Read the summary to validate it exists
  const summaryPath = join(sourceDir, "summary.json");
  const raw = await readFile(summaryPath, "utf-8");
  JSON.parse(raw); // validate JSON

  // Copy run to baseline dir
  await mkdir(baselineDir, { recursive: true });
  const destDir = join(baselineDir, runId);
  await cp(sourceDir, destDir, { recursive: true });

  // Write baseline metadata
  const parsed = JSON.parse(raw);
  const meta: SavedBaseline = {
    run_id: runId,
    saved_at: new Date().toISOString(),
    verdict: parsed.verdict,
    discoveries_count: parsed.discoveries?.length ?? 0,
    summary_path: join(destDir, "summary.json"),
  };

  await writeFile(
    join(baselineDir, "current.json"),
    JSON.stringify(meta, null, 2),
    "utf-8"
  );

  consola.debug(`Baseline saved to ${destDir}`);
  return destDir;
}

export async function loadBaseline(cwd: string): Promise<RunResult | null> {
  const baselineDir = resolve(cwd, BASELINE_DIR);
  try {
    const metaRaw = await readFile(join(baselineDir, "current.json"), "utf-8");
    const meta: SavedBaseline = JSON.parse(metaRaw);
    const summaryRaw = await readFile(meta.summary_path, "utf-8");
    return JSON.parse(summaryRaw);
  } catch {
    return null;
  }
}

export async function listBaselines(cwd: string): Promise<SavedBaseline[]> {
  const baselineDir = resolve(cwd, BASELINE_DIR);
  try {
    const metaRaw = await readFile(join(baselineDir, "current.json"), "utf-8");
    return [JSON.parse(metaRaw)];
  } catch {
    return [];
  }
}

export async function clearBaseline(cwd: string): Promise<void> {
  const baselineDir = resolve(cwd, BASELINE_DIR);
  await rm(baselineDir, { recursive: true, force: true });
}
