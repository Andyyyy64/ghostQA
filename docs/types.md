# Type Definitions

## Overview

All shared types are defined in `packages/core/src/types/`. Config types use Zod schemas with inferred TypeScript types. Other types are plain TypeScript interfaces.

## Config Types

**File:** `packages/core/src/types/config.ts`

See [Configuration](./configuration.md) for full schema reference.

### Exported Types

```typescript
type GhostQAConfig = z.infer<typeof GhostQAConfigSchema>;
type AppConfig = z.infer<typeof AppConfigSchema>;
type EnvironmentConfig = z.infer<typeof EnvironmentConfigSchema>;
type AiConfig = z.infer<typeof AiConfigSchema>;
type ExplorerConfig = z.infer<typeof ExplorerConfigSchema>;
type ReporterConfig = z.infer<typeof ReporterConfigSchema>;
```

### Exported Schemas

```typescript
const AppConfigSchema: z.ZodObject<...>;
const EnvironmentConfigSchema: z.ZodObject<...>;
const AiProviderConfigSchema: z.ZodObject<...>;
const AiConfigSchema: z.ZodObject<...>;
const ExplorerConfigSchema: z.ZodObject<...>;
const ConstraintsConfigSchema: z.ZodObject<...>;
const ReporterConfigSchema: z.ZodObject<...>;
const GhostQAConfigSchema: z.ZodObject<...>;
```

## Impact Types

**File:** `packages/core/src/types/impact.ts`

```typescript
interface DiffFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  patch: string;
}

interface ImpactArea {
  area: string;              // e.g., "Login Page"
  description: string;       // What might be affected
  risk: "high" | "medium" | "low";
  affected_urls: string[];   // URLs to test
  suggested_actions: string[]; // What to test
}

interface DiffAnalysis {
  files: DiffFile[];
  summary: string;           // AI-generated summary
  impact_areas: ImpactArea[];
}
```

## Discovery Types

**File:** `packages/core/src/types/discovery.ts`

### Discovery

A single bug or anomaly found during testing.

```typescript
type Severity = "critical" | "high" | "medium" | "low" | "info";
type DiscoverySource = "explorer" | "console";

interface Discovery {
  id: string;                    // e.g., "ex-ai-xyz789" or "ex-console-abc123"
  source: DiscoverySource;
  severity: Severity;
  title: string;
  description: string;
  url: string;                   // Page URL where found
  screenshot_path?: string;
  video_timestamp?: number;
  console_errors?: string[];
  steps_to_reproduce?: string[];
  timestamp: number;
}
```

### ID Conventions

| Pattern | Source |
|---------|--------|
| `ex-console-<nanoid8>` | Console error detection |
| `ex-ai-<nanoid8>` | AI-reported discovery |

### Verdict

```typescript
type Verdict = "pass" | "fail" | "warn";
```

### RunResult

Complete result of a single pipeline run.

```typescript
interface RunResult {
  run_id: string;
  verdict: Verdict;
  started_at: number;            // Unix timestamp ms
  finished_at: number;
  config: Record<string, any>;   // Original config
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
    is_rate_limited: boolean;
  };
  discoveries: Discovery[];      // All discoveries combined
}
```

## Comparison Types

**File:** `packages/core/src/types/comparison.ts`

### BehavioralDiff

```typescript
interface BehavioralDiff {
  console_errors: {
    base: number;
    head: number;
    delta: number;    // head - base
  };
  http_failures: {
    base: number;
    head: number;
    delta: number;
  };
}
```

### VisualDiffEntry

```typescript
interface VisualDiffEntry {
  page_url: string;           // Derived from screenshot filename
  base_screenshot: string;    // File path
  head_screenshot: string;    // File path
  diff_image: string;         // Heatmap file path
  diff_percent: number;       // 0-100
}
```

### ComparisonResult

```typescript
interface ComparisonResult {
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
    test_regressions: number;     // Positive = more failures in head
    test_fixes: number;           // Positive = fewer failures in head
  };
  behavioral: BehavioralDiff;
  visual: {
    pages_compared: number;
    diffs: VisualDiffEntry[];
  };
  cost: RunResult["cost"];
}
```

## AI Types

**File:** `packages/core/src/ai/provider.ts`

```typescript
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

interface ChatOptions {
  maxTokens?: number;
}

interface AiProvider {
  chat(system: string, messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  chatWithImage(system: string, messages: ChatMessage[], imageBase64: string,
                mediaType?: string, options?: ChatOptions): Promise<ChatResponse>;
}
```

**File:** `packages/core/src/ai/client.ts`

```typescript
type AiTask = "diff_analysis" | "ui_control" | "triage";
```

## Explorer Types

**File:** `packages/core/src/explorer/observer.ts`

```typescript
interface PageState {
  url: string;
  title: string;
  axTree: string;
  screenshotBase64: string;
  consoleLogs: string[];
  timestamp: number;
}
```

**File:** `packages/core/src/explorer/navigator.ts`

```typescript
type ActionType = "click" | "type" | "scroll" | "wait" | "back" | "goto" | "hover" | "select";

interface BrowserAction {
  action: ActionType;
  selector?: string;
  text?: string;
  url?: string;
  direction?: "up" | "down";
  amount?: number;
  duration?: number;
}
```

**File:** `packages/core/src/explorer/planner.ts`

```typescript
interface PlanResult {
  reasoning: string;
  action: BrowserAction;
  observation: string;
  discovery: {
    title: string;
    description: string;
    severity: "critical" | "high" | "medium" | "low" | "info";
  } | null;
  done: boolean;
}
```
