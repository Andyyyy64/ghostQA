# Infrastructure

## Docker Image

**Files:** `packages/docker/Dockerfile`, `packages/docker/entrypoint.sh`

### Dockerfile

Base image: `node:22-slim`

Installed system packages:

- `xvfb` — virtual framebuffer (headless display)
- `ffmpeg` — video processing
- `fonts-noto-cjk` — CJK font support (Japanese, Chinese, Korean)
- Chromium system library dependencies (libatk, libcups, libdrm, libgbm, libnss, etc.)

Setup steps:

1. Enable corepack and activate `pnpm@9`
2. Install Chromium via `npx playwright install chromium`
3. Set working directory to `/workspace`
4. Copy and chmod `entrypoint.sh`

### Entrypoint

```bash
#!/bin/bash
Xvfb :99 -screen 0 1280x720x24 &
export DISPLAY=:99
sleep 1
exec "$@"
```

Starts a virtual display at 1280x720 resolution, then executes the passed command.

### Usage

```bash
# Build
docker build -t ghostqa/runner packages/docker/

# Run ghostQA inside container
docker run --rm -v $(pwd):/workspace ghostqa/runner ghostqa run
```

## Environment Manager

**File:** `packages/core/src/environment/manager.ts`

`setupEnvironment(config, cwd)` returns an `Environment` object:

```typescript
interface Environment {
  mode: "docker" | "native";
  containerId?: string;
  cleanup(): Promise<void>;
}
```

### Native Mode

No-op. Runs everything on the host system directly. `cleanup()` is an empty function.

### Docker Mode

1. Starts a container: `docker run -d --rm -v <cwd>:/workspace -w /workspace <image> tail -f /dev/null`
2. Stores the container ID
3. `cleanup()` runs `docker stop <containerId>`

The container runs in detached mode with `tail -f /dev/null` to keep it alive while the pipeline executes commands inside it.

## App Runner

**File:** `packages/core/src/app-runner/runner.ts`

Manages the application lifecycle: build, start, healthcheck, stop.

### Build

```typescript
await appRunner.build(cwd);
```

- Splits `config.build` string on whitespace into command + args
- Runs with `NODE_ENV=production`
- Inherits `cwd` as working directory
- Throws on non-zero exit code

### Start

```typescript
await appRunner.start(cwd);
```

- Splits `config.start` string into command + args
- Starts as a child process (not awaited — runs in background)
- Immediately calls `waitForHealthy()` to poll the healthcheck URL

### Healthcheck

```typescript
private async waitForHealthy(): Promise<void>
```

Polls `<config.url><config.healthcheck.path>` with `fetch()`:

- Success: `response.ok` (HTTP 200-299)
- Interval: `config.healthcheck.interval` (default 1000ms)
- Timeout: `config.healthcheck.timeout` (default 30000ms)
- On timeout: throws `Error("App failed to become healthy")`
- Fetch errors (connection refused, etc.) are silently retried

### Stop

```typescript
await appRunner.stop();
```

Sends `SIGTERM` to the child process started by `start()`.

## Recorder

**File:** `packages/core/src/recorder/recorder.ts`

Captures evidence during the pipeline run.

### Initialization

```typescript
const recorder = new Recorder(config.reporter, runId);
await recorder.init();
```

Creates directory structure:

```
<output_dir>/<runId>/
  screenshots/
  videos/
  traces/
```

### Context Options

```typescript
recorder.contextOptions()
```

Returns Playwright browser context options:

```typescript
{
  recordVideo: {
    dir: "<runDir>/videos",
    size: { width: 1280, height: 720 }
  },
  recordHar: {
    path: "<runDir>/traces/trace.har"
  }
}
```

Video recording is enabled/disabled based on `config.reporter.video`. HAR recording is always enabled.

### Screenshots

```typescript
// Save to file and return path
const path = await recorder.screenshot(page, "step-1");
// → <runDir>/screenshots/001-step-1.png

// Get base64 string (no file written)
const base64 = await recorder.screenshotBase64(page);
```

Screenshots are numbered sequentially (001, 002, ...) with the label appended.

### Video

Video recording is handled by Playwright's built-in context video recording. No manual management needed — videos are automatically saved to the `videos/` directory when the browser context closes.

Output format: `.webm` (VP8 codec)

### HAR Trace

HTTP Archive (HAR) recording is also handled by Playwright's context-level HAR recording. The trace file captures all HTTP requests and responses during the session.

Output: `traces/trace.har`

## Output Directory Structure

A complete run produces:

```
.ghostqa-runs/
  run-<nanoid>/
    report.html              # Interactive HTML report
    summary.json             # Machine-readable results
    screenshots/
      001-step-1.png         # Step screenshots
      002-step-2.png
      003-console-error.png  # Console error evidence
      004-discovery.png      # Bug evidence
    videos/
      <context-id>.webm      # Full browser session video
    traces/
      trace.har              # HTTP traffic capture
    generated-tests/
      generated-tests.spec.ts # AI-generated Playwright tests
```

For comparison runs, an additional directory contains the comparison:

```
.ghostqa-runs/
  run-<nanoid>/              # Comparison run directory
    comparison.json          # Structured comparison data
    report.html              # Comparison HTML report
  run-<nanoid-base>/         # Base run (full structure above)
  run-<nanoid-head>/         # Head run (full structure above)
```

## Demo App

**Directory:** `examples/demo-app/`

A minimal Todo application used for testing and demos.

### Server

`server.js` — vanilla Node.js HTTP server (no dependencies, ESM):

- `GET /` — serves `index.html`
- `GET /api/todos` — returns hardcoded JSON array of 3 todos
- All other routes — 404

### Intentional Bugs

The demo app contains 3 intentional bugs for testing ghostQA's detection capabilities:

| Bug | Type | Details |
|-----|------|---------|
| Delete button typo | ReferenceError | `onclick="remov(${t.id})"` — function is named `remove`, throws uncaught error |
| Item count display | Logic error | Shows `active` (an array) instead of `active.length`, displays `[object Object]` |
| Clear completed | Logic error | `todos = []` instead of `todos.filter(t => !t.done)`, deletes ALL todos |

### Config

```yaml
app:
  name: demo-app
  build: "echo 'no build needed'"
  start: "node server.js"
  url: "http://localhost:3000"

ai:
  provider: cli
  max_budget_usd: 5.0
  cli:
    command: claude
```
