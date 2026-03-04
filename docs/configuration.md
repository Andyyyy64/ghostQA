# Configuration

## Overview

ghostQA is configured via a `.ghostqa.yml` file in the project root. The config is validated at load time using Zod schemas — invalid configs cause immediate errors with descriptive messages.

**Schema file:** `packages/core/src/types/config.ts`
**Loader file:** `packages/core/src/config/loader.ts`

## Generating a Config

```bash
ghostqa init
```

Creates a `.ghostqa.yml` with all fields and comments. Use `--force` to overwrite existing.

## Validating a Config

```bash
ghostqa validate
```

Parses and validates the config, displays a summary of settings.

## Full Schema Reference

### `app` (required)

Application settings. The only required top-level section.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | — | **Required.** Application name |
| `root` | string | `"."` | Project root directory |
| `build` | string | — | **Required.** Build command (e.g., `"npm run build"`) |
| `start` | string | — | **Required.** Start command (e.g., `"npm start"`) |
| `url` | string (URL) | `"http://localhost:3000"` | Application URL after start |
| `healthcheck.path` | string | `"/"` | Healthcheck endpoint path |
| `healthcheck.timeout` | number | `30000` | Max wait time in ms |
| `healthcheck.interval` | number | `1000` | Poll interval in ms |

### `environment` (optional)

Execution environment settings.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | `"docker"` \| `"native"` | `"native"` | Execution mode |
| `docker.image` | string | `"ghostqa/runner:latest"` | Docker image |
| `docker.volumes` | string[] | `[]` | Additional volume mounts |

### `ai` (optional)

AI provider and budget settings.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `provider` | `"gemini"` \| `"anthropic"` \| `"openai"` \| `"cli"` | `"gemini"` | AI backend |
| `model` | string | `"gemini-2.0-flash"` | Model name |
| `api_key_env` | string | `"GEMINI_API_KEY"` | Environment variable for API key |
| `max_budget_usd` | number | `1.0` | Maximum cost per run in USD |
| `cli.command` | string | `"claude"` | CLI tool command (`claude`, `codex`, `gemini`, or custom) |
| `cli.args` | string[] | `[]` | Extra arguments for CLI tool |
| `routing` | object | `{}` | Per-task provider overrides (see below) |

### `ai.routing` (optional)

Override the AI provider for specific pipeline tasks. Each key accepts the same fields as the top-level `ai` section (minus `max_budget_usd` and `routing`).

| Task Key | Pipeline Stage |
|----------|---------------|
| `diff_analysis` | Git diff → impact area estimation |
| `ui_control` | Explorer: deciding browser actions (vision required) |
| `triage` | Result summarization and report generation |

Example:

```yaml
ai:
  provider: gemini
  model: gemini-2.0-flash
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

### `explorer` (optional)

AI exploration settings.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable AI exploration |
| `max_steps` | number | `50` | Maximum browser actions |
| `max_duration` | number | `300000` | Maximum exploration time in ms (5 minutes) |
| `viewport.width` | number | `1280` | Browser viewport width |
| `viewport.height` | number | `720` | Browser viewport height |

### `constraints` (optional)

Safety constraints to prevent the AI from performing dangerous actions.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `no_payment` | boolean | `false` | Block payment/purchase actions |
| `no_delete` | boolean | `false` | Block delete/remove actions |
| `no_external_links` | boolean | `false` | Prevent navigation to external domains |
| `allowed_domains` | string[] | `[]` | Allowlist for `goto` navigation (empty = all allowed) |
| `forbidden_selectors` | string[] | `[]` | CSS selectors the AI must never interact with |

### `reporter` (optional)

Report output settings.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `output_dir` | string | `".ghostqa-runs"` | Output directory for run results |
| `formats` | `("html" \| "json")[]` | `["html", "json"]` | Report formats to generate |
| `video` | boolean | `true` | Record browser video |
| `screenshots` | boolean | `true` | Capture screenshots |

## Example Configs

### Minimal

```yaml
app:
  name: my-app
  build: "npm run build"
  start: "npm start"
```

### Gemini with Budget

```yaml
app:
  name: my-app
  build: "npm run build"
  start: "npm start"
  url: "http://localhost:3000"

ai:
  provider: gemini
  model: gemini-2.0-flash
  max_budget_usd: 2.0
```

### Anthropic API (Claude)

```yaml
app:
  name: my-app
  build: "npm run build"
  start: "npm start"

ai:
  provider: anthropic
  model: claude-sonnet-4-20250514
  api_key_env: ANTHROPIC_API_KEY
  max_budget_usd: 3.0
```

### OpenAI API

```yaml
app:
  name: my-app
  build: "npm run build"
  start: "npm start"

ai:
  provider: openai
  model: gpt-4o
  api_key_env: OPENAI_API_KEY
  max_budget_usd: 2.0
```

### Claude CLI

```yaml
app:
  name: my-app
  build: "pnpm build"
  start: "pnpm start"

ai:
  provider: cli
  max_budget_usd: 5.0
  cli:
    command: claude
```

### Gemini CLI

```yaml
app:
  name: my-app
  build: "pnpm build"
  start: "pnpm start"

ai:
  provider: cli
  max_budget_usd: 5.0
  cli:
    command: gemini
```

### Full Config with Constraints

```yaml
app:
  name: my-app
  build: "pnpm build"
  start: "pnpm start"
  url: "http://localhost:3000"
  healthcheck:
    path: "/health"
    timeout: 60000

ai:
  provider: gemini
  model: gemini-2.0-flash
  max_budget_usd: 3.0
  routing:
    diff_analysis:
      provider: cli
      cli:
        command: claude

explorer:
  enabled: true
  max_steps: 80
  max_duration: 600000
  viewport:
    width: 1440
    height: 900

constraints:
  no_payment: true
  no_delete: true
  no_external_links: true
  allowed_domains:
    - localhost
    - "127.0.0.1"
  forbidden_selectors:
    - ".admin-panel"
    - "#danger-zone"

reporter:
  output_dir: .ghostqa-runs
  formats: [html, json]
  video: true
  screenshots: true
```

## Config Loading Behavior

1. Reads `.ghostqa.yml` from `cwd` (or specified path)
2. Parses YAML to JavaScript object
3. Validates through `GhostQAConfigSchema.parse()` (Zod)
4. Applies all defaults for omitted fields
5. Returns fully-typed `GhostQAConfig` object

Unknown fields in the YAML are silently stripped by Zod (strict mode is not enabled).
