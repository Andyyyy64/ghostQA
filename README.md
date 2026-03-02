# ghostQA

AI-powered browser testing that finds bugs in your code changes.

ghostQA analyzes your git diff, launches your app, and lets an AI actually operate a browser to generate tests and explore your application for regressions, crashes, and visual bugs.

## How It Works

```
git diff → AI Impact Analysis → Build & Start App → Browser Testing → HTML Report
```

ghostQA runs two layers of testing against your application:

**Layer A (Test Generation)** - The AI reads your diff, identifies affected areas, and generates targeted Playwright E2E tests. These tests are executed automatically and results are collected.

**Layer B (AI Exploration)** - An AI agent autonomously navigates your app in a real browser. It observes the page (accessibility tree + screenshots), plans actions, interacts with UI elements, and reports any anomalies it discovers - console errors, crashes, broken layouts, unexpected behavior.

## Quick Start

### Prerequisites

- Node.js >= 22
- Git
- One of the following AI providers:
  - `GEMINI_API_KEY` environment variable (default, Google Gemini)
  - [Claude Code](https://github.com/anthropics/claude-code) CLI installed
  - [Codex](https://github.com/openai/codex) CLI installed

### Install

```bash
pnpm add -g ghostqa
```

### Initialize

```bash
cd your-project
ghostqa init
```

This creates a `.ghostqa.yml` config file. Edit it to match your project:

```yaml
app:
  name: my-app
  build: "npm run build"
  start: "npm start"
  url: "http://localhost:3000"

ai:
  provider: gemini          # or: cli
  model: gemini-2.0-flash
  max_budget_usd: 1.0
```

### Run

```bash
ghostqa run
```

ghostQA will:

1. Analyze your latest git diff
2. Build and start your application
3. Generate and run targeted E2E tests (Layer A)
4. Explore your app autonomously with AI (Layer B)
5. Output an HTML report with findings

### View Report

```bash
ghostqa view
```

Opens the latest HTML report in your browser.

### Check Setup

```bash
ghostqa doctor
```

Verifies that all dependencies are installed and configured.

## Configuration

### AI Providers

ghostQA supports multiple AI backends:

**Gemini API (default)**

```yaml
ai:
  provider: gemini
  model: gemini-2.0-flash
  api_key_env: GEMINI_API_KEY
```

**CLI Tools** - Use an already-installed CLI LLM tool as the backend. No API key needed.

```yaml
ai:
  provider: cli
  cli:
    command: claude    # or: codex
```

### CLI Options

```
ghostqa run [options]

Options:
  -c, --config <path>   Config file path (default: ".ghostqa.yml")
  --diff <ref>          Git diff reference (default: HEAD~1)
  --no-layer-a          Skip Layer A (generated E2E tests)
  --no-layer-b          Skip Layer B (AI exploration)
  --budget <usd>        Override max budget in USD
```

### Full Config Reference

```yaml
app:
  name: my-app                    # Application name
  root: "."                       # Project root
  build: "npm run build"          # Build command
  start: "npm start"              # Start command
  url: "http://localhost:3000"    # App URL after start
  healthcheck:
    path: "/"                     # Healthcheck endpoint
    timeout: 30000                # Max wait time (ms)
    interval: 1000                # Poll interval (ms)

environment:
  mode: native                    # native or docker
  docker:
    image: ghostqa/runner:latest
    volumes: []

ai:
  provider: gemini                # gemini or cli
  model: gemini-2.0-flash
  max_budget_usd: 1.0            # Cost limit for AI calls
  api_key_env: GEMINI_API_KEY
  cli:
    command: claude               # CLI tool command
    args: []                      # Extra arguments

layer_a:
  enabled: true
  max_tests: 10                   # Max generated tests
  timeout_per_test: 30000         # Per-test timeout (ms)

layer_b:
  enabled: true
  max_steps: 50                   # Max exploration steps
  max_duration: 300000            # Max exploration time (ms)
  viewport:
    width: 1280
    height: 720

reporter:
  output_dir: .ghostqa-runs
  formats: [html, json]
  video: true
  screenshots: true
```

## Output

Each run creates a directory under `.ghostqa-runs/<run-id>/` containing:

```
.ghostqa-runs/run-abc123/
  report.html        # Interactive HTML report
  summary.json       # Machine-readable results
  screenshots/       # Captured screenshots
  videos/            # Browser session recordings
```

The report includes:

- **Verdict** - PASS / FAIL / WARN based on discovery severity
- **Diff summary** - What changed and what areas are affected
- **Layer A results** - Generated test pass/fail counts
- **Layer B results** - Exploration steps, pages visited
- **Discoveries** - Found issues with severity, description, screenshots, console errors, and reproduction steps
- **Cost** - Total AI token usage and cost

## Architecture

```
packages/
  cli/          CLI entry point (ghostqa command)
  core/         Business logic
    ai/         AI provider abstraction (Gemini, CLI tools)
    config/     YAML config + Zod validation
    diff-analyzer/   Git diff parsing + LLM impact analysis
    environment/     Docker / native environment management
    app-runner/      Build → start → healthcheck
    layer-a/         E2E test generation + execution
    layer-b/         AI exploration loop
    recorder/        Video / screenshot / console capture
    reporter/        HTML + JSON report generation
    orchestrator/    Pipeline coordination
  docker/       Docker runner image
  action/       GitHub Action (planned)
```

## License

MIT
