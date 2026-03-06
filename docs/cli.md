# CLI

## Overview

The ghostQA CLI is built with commander.js and provides 9 commands. The CLI package (`packages/cli`) is a thin wrapper that imports all business logic from `@ghostqa/core`.

**Entry point:** `packages/cli/src/index.ts`
**Binary name:** `ghostqa`

## Commands

### `ghostqa init`

Generate a `.ghostqa.yml` configuration file.

```bash
ghostqa init [options]

Options:
  --force    Overwrite existing config file
```

**Behavior:**

1. Checks if `.ghostqa.yml` already exists
2. If exists and no `--force`: warns and exits
3. Calls `generateConfig(cwd)` to write the template
4. Suggests running `ghostqa doctor` and then `ghostqa run`

### `ghostqa run`

Execute the testing pipeline.

```bash
ghostqa run [options]

Options:
  -c, --config <path>    Config file path (default: ".ghostqa.yml")
  --diff <ref>           Git diff reference (default: "HEAD~1")
  --base <ref>           Base git ref for Before/After comparison
  --head <ref>           Head git ref (default: "HEAD")
  --baseline             Compare against the saved baseline
  --no-explore           Skip AI exploration
  --budget <usd>         Override max AI budget in USD
```

**Mode Selection:**

- If `--base` is provided → runs `comparePipeline()` (Before/After comparison)
- Otherwise → runs `runPipeline()` with `diffRef` from `--diff`

**Output:**

- Displays verdict (PASS / FAIL / WARN) with color
- Shows cost: USD amount for API providers, rate-limit guidance for CLI providers
- Shows report path

**Exit Codes:**

| Code | Meaning |
|------|---------|
| 0 | PASS or WARN |
| 1 | FAIL |
| 130 | Interrupted (SIGINT) |

### `ghostqa view`

Open the latest HTML report in a browser.

```bash
ghostqa view [options]

Options:
  --run <id>     Specific run ID to view
  --dir <path>   Override runs directory
```

**Behavior:**

1. Reads all `run-*` directories from `.ghostqa-runs/`
2. Sorts by modification time (newest first)
3. Opens `report.html` with the system default browser

### `ghostqa doctor`

Check that all dependencies are installed and configured.

```bash
ghostqa doctor
```

**Checks performed (in order):**

| Check | Required | How |
|-------|----------|-----|
| Node.js >= 22 | Yes | `process.version` |
| Git | Yes | `which git` |
| Docker | No | `docker --version` |
| `GEMINI_API_KEY` | No* | `process.env` |
| `ANTHROPIC_API_KEY` | No* | `process.env` |
| `OPENAI_API_KEY` | No* | `process.env` |
| `claude` CLI | No* | `which claude` |
| `codex` CLI | No* | `which codex` |
| `gemini` CLI | No* | `which gemini` |
| Playwright browsers | No | `node -e "require('playwright').chromium.executablePath()"` |

\* At least one AI provider (API key or CLI tool) is required.

**Exit code:** `1` if any required check fails or no AI provider is found.

### `ghostqa validate`

Validate the `.ghostqa.yml` configuration file.

```bash
ghostqa validate [options]

Options:
  -c, --config <path>    Config file path
```

**Output on success:**

```
✔ Configuration is valid
  App: my-app
  AI: cli (gemini-3.1-flash-lite-preview)
  Explorer: enabled
  Constraints: no_payment, no_delete
```

**Exit code:** `1` if config is invalid (Zod validation error).

### `ghostqa record`

Record a manual browser session.

```bash
ghostqa record [options]

Options:
  -c, --config <path>    Config file path
```

**Behavior:**

1. Loads config to get the target URL
2. Launches a **headed** (visible) Chromium browser
3. Navigates to the app URL
4. Records video to `.ghostqa-recordings/`
5. Waits for the browser to be closed manually
6. Logs completion

This command is useful for creating reference recordings or debugging UI issues.

### `ghostqa estimate`

Estimate AI cost before running the pipeline.

```bash
ghostqa estimate [options]

Options:
  -c, --config <path>    Config file path
  --diff <ref>           Git diff reference (default: "HEAD~1")
```

**Behavior:**

1. Loads config to determine provider and budget settings
2. Reads `git diff --stat` to estimate changed line count
3. Computes token and cost estimates with `estimateCost()`
4. Prints either a USD range or CLI rate-limit guidance

### `ghostqa baseline`

Manage approved baseline runs stored under `.ghostqa-baseline/`.

```bash
ghostqa baseline save <run-id>
ghostqa baseline show
ghostqa baseline list
ghostqa baseline clear
```

**Behavior:**

- `save <run-id>` copies an existing run directory into `.ghostqa-baseline/`
- `show` prints the currently approved baseline
- `list` lists saved baselines (currently the active baseline entry)
- `clear` removes saved baseline metadata and files

### `ghostqa replay`

Run a previously generated Playwright replay spec.

```bash
ghostqa replay <path>
```

**Behavior:**

1. Resolves the replay spec path from the current working directory
2. Runs `npx playwright test <path>`
3. Exits with the same status code as Playwright
