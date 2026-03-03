import { resolve, join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import consola from "consola";
import type { GhostQAConfig } from "../types/config";
import type { RunResult } from "../types/discovery";
import type { ComparisonResult } from "../types/comparison";
import { runPipeline } from "./run-pipeline";
import { Comparator } from "../comparator/comparator";
import { Reporter } from "../reporter/reporter";

export interface CompareOptions {
  config: GhostQAConfig;
  cwd: string;
  baseRef: string;
  headRef: string;
  onProgress?: (msg: string) => void;
}

export async function comparePipeline(
  options: CompareOptions
): Promise<ComparisonResult & { report_path: string }> {
  const { config, cwd, baseRef, headRef, onProgress } = options;

  // Resolve actual commit hashes
  const baseCommit = resolveRef(cwd, baseRef);
  const headCommit = resolveRef(cwd, headRef);
  consola.info(`Comparing: ${baseCommit.slice(0, 8)} (base) → ${headCommit.slice(0, 8)} (head)`);

  // Check working tree is clean
  const status = execSync("git status --porcelain", { cwd, encoding: "utf-8" }).trim();
  if (status) {
    consola.warn("Working tree has uncommitted changes — stashing...");
    execSync("git stash push -m 'ghostqa-compare-auto-stash'", { cwd });
  }

  const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
    cwd,
    encoding: "utf-8",
  }).trim();

  let basePipelineResult;
  let headPipelineResult;
  const didStash = !!status;

  try {
    // Phase 1: Run on base
    onProgress?.("Checking out base commit...");
    execSync(`git checkout ${baseCommit} --quiet`, { cwd });

    onProgress?.("Running pipeline on base...");
    basePipelineResult = await runPipeline({
      config,
      cwd,
      diffRef: `${baseCommit}~1`,
      onProgress: (msg) => onProgress?.(`[BASE] ${msg}`),
    });

    // Phase 2: Run on head
    onProgress?.("Checking out head commit...");
    execSync(`git checkout ${headCommit} --quiet`, { cwd });

    onProgress?.("Running pipeline on head...");
    headPipelineResult = await runPipeline({
      config,
      cwd,
      diffRef: `${baseCommit}..${headCommit}`,
      onProgress: (msg) => onProgress?.(`[HEAD] ${msg}`),
    });
  } finally {
    // Restore original state
    onProgress?.("Restoring working tree...");
    try {
      execSync(`git checkout ${currentBranch} --quiet`, { cwd });
    } catch {
      execSync(`git checkout ${headCommit} --quiet`, { cwd });
    }
    if (didStash) {
      try {
        execSync("git stash pop", { cwd });
      } catch {
        consola.warn("Could not pop stash — your changes are in 'git stash list'");
      }
    }
  }

  // Read full RunResult from each run's summary.json
  const baseRunDir = resolve(cwd, config.reporter.output_dir, basePipelineResult.run_id);
  const headRunDir = resolve(cwd, config.reporter.output_dir, headPipelineResult.run_id);

  const baseResult: RunResult = JSON.parse(
    await readFile(join(baseRunDir, "summary.json"), "utf-8")
  );
  const headResult: RunResult = JSON.parse(
    await readFile(join(headRunDir, "summary.json"), "utf-8")
  );

  // Phase 3: Compare
  onProgress?.("Comparing results...");
  const comparator = new Comparator();
  const comparison = comparator.compare(baseResult, headResult, baseRef, headRef);

  // Try visual diff if screenshots exist
  try {
    const diffDir = resolve(headRunDir, "visual-diff");
    const visualDiffs = await comparator.compareVisual(baseRunDir, headRunDir, diffDir);
    comparison.visual = {
      pages_compared: visualDiffs.length,
      diffs: visualDiffs,
    };
  } catch {
    consola.debug("Visual diff skipped (pixelmatch/pngjs not available or no screenshots)");
  }

  // Phase 4: Generate comparison report
  onProgress?.("Generating comparison report...");
  await mkdir(headRunDir, { recursive: true });

  await writeFile(
    join(headRunDir, "comparison.json"),
    JSON.stringify(comparison, null, 2),
    "utf-8"
  );

  const reporter = new Reporter(headRunDir);
  const reportPath = await reporter.writeComparisonHtml(comparison);

  return {
    ...comparison,
    report_path: reportPath,
  };
}

function resolveRef(cwd: string, ref: string): string {
  return execSync(`git rev-parse ${ref}`, { cwd, encoding: "utf-8" }).trim();
}
