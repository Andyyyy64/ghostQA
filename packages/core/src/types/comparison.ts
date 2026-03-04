import type { Discovery, RunResult, Verdict } from "./discovery";

export interface BehavioralDiff {
  console_errors: { base: number; head: number; delta: number };
  http_failures: { base: number; head: number; delta: number };
}

export interface VisualDiffEntry {
  page_url: string;
  base_screenshot: string;
  head_screenshot: string;
  diff_image: string;
  diff_percent: number;
}

export interface ComparisonResult {
  run_id: string;
  verdict: Verdict;
  base_ref: string;
  head_ref: string;
  started_at: number;
  finished_at: number;

  diff_analysis: {
    summary: string;
    files_changed: number;
    impact_areas: number;
  };

  base: {
    run_id: string;
    explorer: RunResult["explorer"];
    discoveries: Discovery[];
  };

  head: {
    run_id: string;
    explorer: RunResult["explorer"];
    discoveries: Discovery[];
  };

  regressions: {
    new_discoveries: Discovery[];
    fixed_discoveries: Discovery[];
  };

  behavioral: BehavioralDiff;

  visual: {
    pages_compared: number;
    diffs: VisualDiffEntry[];
  };

  cost: RunResult["cost"];
}
