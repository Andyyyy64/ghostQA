# GitHub Action

## Overview

The ghostQA GitHub Action (`packages/action`) runs the testing pipeline in CI and posts results as PR comments.

**File:** `packages/action/src/index.ts`
**Action definition:** `packages/action/action.yml`

## Action Definition

```yaml
name: ghostQA
description: AI-powered browser testing that finds bugs in your code changes

branding:
  icon: search
  color: purple
```

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `config` | `.ghostqa.yml` | Path to config file |
| `base` | (auto-detected) | Base git ref for comparison |
| `head` | `HEAD` | Head git ref |
| `budget` | (from config) | Override max budget in USD |
| `explore` | `true` | Enable AI exploration |
| `comment` | `true` | Post PR comment with results |

## Outputs

| Output | Description |
|--------|-------------|
| `verdict` | `pass`, `warn`, or `fail` |
| `discoveries` | Number of bugs found |
| `report-path` | Path to the HTML report file |
| `cost` | Total USD spent on AI calls |

## PR Auto-Detection

When triggered by a `pull_request` event, the action automatically detects:

```typescript
const pr = github.context.payload.pull_request;
const baseRef = pr.base.sha;  // used as --base if not explicitly set
```

## Workflow Example

### Basic

```yaml
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
          fetch-depth: 0    # Full history needed for git diff

      - uses: Andyyyy64/ghostQA@v0
        with:
          budget: "2.0"
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

### With Anthropic API

```yaml
      - uses: Andyyyy64/ghostQA@v0
        with:
          budget: "5.0"
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Skip Exploration

```yaml
      - uses: Andyyyy64/ghostQA@v0
        with:
          explore: "false"
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

### Use Verdict in Subsequent Steps

```yaml
      - uses: Andyyyy64/ghostQA@v0
        id: ghostqa
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}

      - run: echo "Verdict was ${{ steps.ghostqa.outputs.verdict }}"

      - run: echo "Found ${{ steps.ghostqa.outputs.discoveries }} bugs"
```

## PR Comment

When `comment: true` (default) and the trigger is a `pull_request` event, the action posts a comment on the PR.

### Comment Management

- Searches for an existing comment containing `"ghostqa Report"` (case-sensitive)
- If found: updates the existing comment (avoids comment spam)
- If not found: creates a new comment
- Uses `GITHUB_TOKEN` for authentication (automatically available in Actions)

## Artifact Upload

The action itself does **not** upload `.ghostqa-runs/` as a workflow artifact. Add an explicit upload step if you want to preserve reports, videos, and traces:

```yaml
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: ghostqa-runs
          path: .ghostqa-runs
```

### Comparison Comment Format

For Before/After runs (`--base` provided):

```markdown
## ghostqa Report

**Verdict: FAIL** | Cost: $1.23

### Before / After

| Metric | Base | Head |
|--------|------|------|
| Discoveries | 0 | 1 |
| Console Errors | 0 | 3 |

### New Issues

- **[high]** Login form crashes on empty submit

### Fixed Issues

- **[medium]** Minor layout shift on mobile
```

### Single Run Comment Format

For single runs (no `--base`):

```markdown
## ghostqa Report

**Verdict: FAIL** | Cost: $0.45

### Discoveries

- **[high]** Button click throws uncaught TypeError
- **[medium]** Console error: Failed to fetch /api/data
```

## Build Configuration

The action is bundled with tsup:

```typescript
// packages/action/tsup.config.ts
{
  entry: ["src/index.ts"],
  format: ["cjs"],          // GitHub Actions requires CJS
  target: "node20",
  external: ["playwright", "playwright-core"]
}
```

All dependencies except Playwright are bundled into a single `dist/index.js` file (~1.9MB).

## Failure Handling

- If verdict is `"fail"`: calls `core.setFailed()` which sets the Action's exit code to 1
- This causes the GitHub check to show as failed
- The PR comment is still posted before the failure
