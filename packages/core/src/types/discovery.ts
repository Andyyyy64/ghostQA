export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type DiscoverySource = "explorer" | "console" | "structural";

export interface Discovery {
  id: string;
  source: DiscoverySource;
  severity: Severity;
  title: string;
  description: string;
  url: string;
  screenshot_path?: string;
  video_timestamp?: number;
  console_errors?: string[];
  steps_to_reproduce?: string[];
  confidence?: "high" | "medium" | "low";
  timestamp: number;
}

export type Verdict = "pass" | "fail" | "warn";

export interface RunResult {
  run_id: string;
  verdict: Verdict;
  started_at: number;
  finished_at: number;
  config: Record<string, unknown>;
  diff_analysis: {
    summary: string;
    files_changed: number;
    impact_areas: number;
  };
  explorer: {
    steps_taken: number;
    pages_visited: number;
    discoveries: Discovery[];
  };
  cost: {
    total_usd: number;
    input_tokens: number;
    output_tokens: number;
    /** true when using CLI provider (rate-limited, not cost-based) */
    is_rate_limited: boolean;
  };
  discoveries: Discovery[];
}
