# Pipeline

## Single Run Pipeline

**File:** `packages/core/src/orchestrator/run-pipeline.ts`

`ghostqa run` executes a 7-step pipeline:

```
Step 1: Diff Analysis
Step 2: Environment Setup
Step 3: Build
Step 4: App Start + Healthcheck
Step 5: Layer A (Test Generation + Execution)
Step 6: Layer B (AI Exploration)
Step 7: Report Generation
```

### Step 1: Diff Analysis

```typescript
ai.useTask("diff_analysis");
const analysis = await diffAnalyzer.analyze(cwd, diffRef);
ai.resetTask();
```

- Runs `git diff <diffRef>` to get the raw diff text
- Parses diff into structured `DiffFile[]` (file paths, additions, deletions, patches)
- Sends to AI to estimate impact areas (which screens/features are affected)
- Returns `DiffAnalysis { files, summary, impact_areas }`

### Step 2: Environment Setup

```typescript
const env = await setupEnvironment(config.environment, cwd);
```

- **Native mode:** No-op (uses host system directly)
- **Docker mode:** Starts a container with the project mounted at `/workspace`

### Step 3: Build

```typescript
await appRunner.build(cwd);
```

Runs the user's build command (e.g., `npm run build`) with `NODE_ENV=production`.

### Step 4: App Start

```typescript
await appRunner.start(cwd);
```

- Starts the app as a child process (e.g., `npm start`)
- Polls the healthcheck URL until it responds with `200 OK`
- Default timeout: 30 seconds, poll interval: 1 second

### Step 5: Layer A

```typescript
if (config.layer_a.enabled && analysis.impact_areas.length > 0) {
  layerAResult = await layerARunner.run(analysis);
}
```

- AI generates Playwright test code based on the diff analysis
- Tests are written to disk and executed via Playwright CLI
- Failed tests retry once
- Failures become `Discovery` objects (severity: `high`)

See [Layer A](./layer-a.md) for details.

### Step 6: Layer B

```typescript
if (config.layer_b.enabled && analysis.impact_areas.length > 0) {
  layerBResult = await layerBRunner.run(page, analysis, onProgress);
}
```

- AI agent explores the app in a real browser
- Observe → plan → act loop until guardrails stop it
- Discovers bugs via console error detection and AI observation

See [Layer B](./layer-b.md) for details.

### Step 7: Report

```typescript
const verdict = reporter.determineVerdict(discoveries);
await reporter.writeJson(result);
await reporter.writeHtml(result);
```

- Determines verdict: PASS / FAIL / WARN based on discovery severity
- Writes `summary.json` (machine-readable)
- Writes `report.html` (dark-themed interactive report)

### Browser Lifecycle

The pipeline manages a single Playwright browser instance:

```typescript
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: config.layer_b.viewport,
  ...recorder.contextOptions(),  // video + HAR recording
});
const page = await context.newPage();
```

The context is configured with video recording and HAR tracing from the start. The same page is shared between Layer A (for context) and Layer B (for exploration).

### Signal Handling

SIGINT (Ctrl+C) and SIGTERM handlers are installed during the run:

```
Signal received → close browser context → close browser → stop app → cleanup environment → exit(130)
```

This ensures no zombie processes or dangling containers.

### Budget Exceeded Handling

If `BudgetExceededError` is thrown at any point during Layer A or B:

```
Catch BudgetExceededError → log warning → skip to Step 7 → generate partial report
```

The partial report includes whatever results were collected before the budget ran out.

### Output Directory

```
<cwd>/<reporter.output_dir>/<run-id>/
  report.html
  summary.json
  screenshots/
  videos/
  traces/
  generated-tests/
```

`run-id` is generated as `run-<nanoid(10)>`.

---

## Compare Pipeline (Before/After)

**File:** `packages/core/src/orchestrator/compare-pipeline.ts`

`ghostqa run --base <ref>` executes a dual-run comparison:

```
Phase 1: Resolve git refs
Phase 2: Stash dirty changes
Phase 3: Run pipeline on base
Phase 4: Run pipeline on head
Phase 5: Restore git state
Phase 6: Compare results
Phase 7: Generate comparison report
```

### Phase 1: Resolve Refs

```typescript
const baseCommit = execSync(`git rev-parse ${baseRef}`);
const headCommit = execSync(`git rev-parse ${headRef}`);
```

### Phase 2: Stash

If `git status --porcelain` shows changes, runs `git stash` to save them.

### Phase 3: Base Run

```typescript
execSync(`git checkout ${baseCommit}`);
const baseResult = await runPipeline({ diffRef: `${baseCommit}~1` });
```

Checks out the base commit and runs the full single-run pipeline.

### Phase 4: Head Run

```typescript
execSync(`git checkout ${headCommit}`);
const headResult = await runPipeline({ diffRef: `${baseCommit}..${headCommit}` });
```

Checks out the head commit and runs the pipeline with the diff between base and head.

### Phase 5: Restore

```typescript
execSync(`git checkout ${currentBranch}`);  // or headCommit if detached
if (stashed) execSync(`git stash pop`);
```

### Phase 6: Compare

```typescript
const comparator = new Comparator();
const comparison = comparator.compare(baseResult, headResult, baseRef, headRef);

// Visual diff (optional, skipped on error)
comparison.visual = await comparator.compareVisual(baseRunDir, headRunDir, diffDir);
```

See [Comparator](./comparator.md) for details.

### Phase 7: Comparison Report

```typescript
await writeFile(join(runDir, "comparison.json"), JSON.stringify(comparison));
await reporter.writeComparisonHtml(comparison);
```

Generates both machine-readable JSON and a comparison HTML report showing:

- Before/After stats table
- New issues vs. fixed issues
- Visual diff heatmaps
- Console error deltas

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | PASS — no issues found |
| 1 | FAIL — critical/high severity issues or test regressions |
| 130 | Interrupted (SIGINT) |
