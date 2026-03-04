<h1 align="center">ghostQA</h1>

<p align="center">
  <strong>AI-powered regression testing. Zero test code required.</strong>
</p>

<p align="center">
  ghostQA reads your git diff, launches your app, and sends an AI to operate a real browser —<br>
  exploring pages and catching bugs <em>before</em> your users do.
</p>

---

## Why ghostQA?

You ship a PR. The diff looks fine. But did it break the checkout page? Does the form still submit? Is there a new console error you didn't notice?

**If you have E2E tests**, great — but they only cover what you already thought to test.
**If you don't have E2E tests**, you're flying blind.

ghostQA fills the gap:

- **No tests to write** — the AI explores your app autonomously, driven by what your diff actually changed
- **No scenarios to define** — the AI decides what to test based on the actual code changes
- **Evidence, not opinions** — every finding comes with screenshots, video, console logs, and reproduction steps
- **Works with any dev tool** — Cursor, Claude Code, Codex, hand-written code. ghostQA doesn't care how you write code, only what changed

## What It Does

```
git diff → AI Impact Analysis → Build & Start App → AI Exploration → HTML Report
```

### AI Exploration

An AI agent autonomously navigates your running app in a real browser. It reads the accessibility tree and screenshots, plans what to do next, clicks buttons, fills forms, and reports anything wrong — crashes, console errors, broken layouts, dead clicks, blank pages, infinite loading states.

The AI doesn't follow a script. It explores based on what your diff actually changed.

### Before/After Comparison

Run against two git refs to see exactly what regressed:

```bash
ghostqa run --base main --head HEAD
```

This runs the full pipeline on both versions and generates:
- **Visual diff** — pixel-level screenshot comparison with heatmaps
- **Behavioral diff** — console error count changes between versions
- **Regression detection** — new bugs vs. fixed bugs, side by side

## Quick Start

### Prerequisites

- **Node.js >= 22**
- **Git**
- **AI provider** (pick one):
  - Set `GEMINI_API_KEY` env var (Google Gemini — default, free tier available)
  - Install [Claude Code](https://github.com/anthropics/claude-code) CLI
  - Install [Codex](https://github.com/openai/codex) CLI

### 1. Install

```bash
npm install -g ghostqa
```

### 2. Initialize

```bash
cd your-project
ghostqa init
```

Edit the generated `.ghostqa.yml`:

```yaml
app:
  name: my-app
  build: "npm run build"
  start: "npm start"
  url: "http://localhost:3000"

ai:
  provider: gemini       # or: cli (for Claude Code / Codex)
  max_budget_usd: 1.0
```

### 3. Run

```bash
ghostqa run
```

That's it. ghostQA will:

1. Parse your latest git diff and estimate impact areas with AI
2. Build and start your application
3. Launch an AI agent to explore your app in a real browser
4. Record video, screenshots, and console logs
5. Output an HTML report with a PASS / FAIL / WARN verdict

### 4. View the report

```bash
ghostqa view
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `ghostqa init` | Generate a `.ghostqa.yml` config file |
| `ghostqa run` | Run the full testing pipeline |
| `ghostqa run --base main` | Compare HEAD against a base ref |
| `ghostqa view` | Open the latest HTML report |
| `ghostqa validate` | Check your config file for errors |
| `ghostqa doctor` | Verify dependencies (Node, Playwright, AI provider) |
| `ghostqa record` | Record a manual browser session |

### Run Options

```
ghostqa run [options]

  --base <ref>           Base git ref for Before/After comparison
  --head <ref>           Head git ref (default: HEAD)
  --diff <ref>           Git diff reference (default: HEAD~1)
  --no-explore           Skip AI exploration
  --budget <usd>         Override max AI budget
  -c, --config <path>    Config file path (default: .ghostqa.yml)
```

## AI Providers

### Gemini API (default)

```yaml
ai:
  provider: gemini
  model: gemini-2.0-flash
  api_key_env: GEMINI_API_KEY
  max_budget_usd: 1.0
```

### CLI Tools (no API key needed)

Use Claude Code or Codex as the AI backend. Uses your existing CLI subscription.

```yaml
ai:
  provider: cli
  cli:
    command: claude     # or: codex
```

### Task-Specific Routing

Route different tasks to different providers for cost optimization:

```yaml
ai:
  provider: gemini
  max_budget_usd: 3.0
  routing:
    diff_analysis:
      provider: cli
      cli:
        command: claude
    ui_control:
      provider: gemini
      model: gemini-2.0-flash
```

## Output

Each run creates a directory under `.ghostqa-runs/`:

```
.ghostqa-runs/run-abc123/
  report.html          Interactive HTML report (dark theme)
  summary.json         Machine-readable results
  screenshots/         Step-by-step + discovery screenshots
  videos/              Full browser session recordings (.webm)
  traces/              HAR network trace
```

The HTML report includes:

- **Verdict card** — PASS / FAIL / WARN with color coding
- **Diff analysis** — what changed, what areas are impacted
- **Explorer trace** — every exploration step with screenshots
- **Discoveries** — each bug with severity, description, evidence screenshot, console errors
- **Cost breakdown** — AI token usage and spend

## Constraints

Prevent the AI from performing dangerous actions:

```yaml
constraints:
  no_payment: true            # Block purchase/payment actions
  no_delete: true             # Block delete operations
  no_external_links: true     # Stay on allowed domains
  allowed_domains:
    - localhost
    - "127.0.0.1"
  forbidden_selectors:
    - ".admin-only"
    - "#danger-zone"
```

## GitHub Action

```yaml
# .github/workflows/ghostqa.yml
name: ghostQA
on:
  pull_request:

jobs:
  ghostqa:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: ghostqa/action@v0
        with:
          budget: "2.0"
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

The action automatically:
- Detects the base/head refs from the PR context
- Runs the full pipeline
- Posts a summary comment on the PR with verdict, results, and discovery count

## Full Config Reference

```yaml
app:
  name: my-app                     # Application name
  root: "."                        # Project root directory
  build: "npm run build"           # Build command
  start: "npm start"               # Start command
  url: "http://localhost:3000"     # App URL after start
  healthcheck:
    path: "/"                      # Healthcheck endpoint
    timeout: 30000                 # Max wait (ms)
    interval: 1000                 # Poll interval (ms)

environment:
  mode: native                     # native or docker

ai:
  provider: gemini                 # gemini or cli
  model: gemini-2.0-flash
  max_budget_usd: 1.0
  api_key_env: GEMINI_API_KEY
  cli:
    command: claude
    args: []
  routing:                         # Optional: per-task provider overrides
    diff_analysis: { ... }
    ui_control: { ... }
    triage: { ... }

explorer:
  enabled: true
  max_steps: 50                    # Max exploration steps
  max_duration: 300000             # Max exploration time (ms)
  viewport:
    width: 1280
    height: 720

constraints:
  no_payment: false
  no_delete: false
  no_external_links: false
  allowed_domains: []
  forbidden_selectors: []

reporter:
  output_dir: .ghostqa-runs
  formats: [html, json]
  video: true
  screenshots: true
```

## Architecture

```
packages/
  cli/               CLI entry point (6 commands)
  core/              Business logic
    ai/              AI provider abstraction + task routing
    comparator/      Before/After comparison (visual + behavioral diff)
    config/          YAML + Zod schema validation
    diff-analyzer/   Git diff parsing + LLM impact analysis
    environment/     Docker / native environment management
    app-runner/      Build -> start -> healthcheck
    explorer/        AI exploration loop (observe -> plan -> act -> discover)
    recorder/        Video / screenshot / console / HAR capture
    reporter/        HTML + JSON report generation
    orchestrator/    Pipeline coordination
  action/            GitHub Action
  docker/            Docker runner image
examples/
  demo-app/          Todo app for testing (with intentional bugs)
```

## License

MIT
