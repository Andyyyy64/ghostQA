# AI System

## Overview

The AI system is built on a provider abstraction that allows swapping backends without changing business logic. An `AiClient` facade adds task routing and cost tracking on top.

```
AiClient (facade)
  ├── AiProvider (interface)
  │     ├── GeminiProvider     (Google Gemini API)
  │     ├── AnthropicProvider  (Anthropic API)
  │     ├── OpenAIProvider     (OpenAI API)
  │     └── CliProvider        (claude/codex/gemini via stdin)
  ├── CostTracker (budget enforcement)
  └── Task Routing (per-task provider selection)
```

## Provider Interface

**File:** `packages/core/src/ai/provider.ts`

```typescript
interface AiProvider {
  chat(system: string, messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  chatWithImage(system: string, messages: ChatMessage[], imageBase64: string,
                mediaType?: string, options?: ChatOptions): Promise<ChatResponse>;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}
```

To add a new provider, implement this interface and register it in `AiClient.createProvider()`.

## GeminiProvider

**File:** `packages/core/src/ai/gemini-provider.ts`

Uses `@google/generative-ai` SDK.

- Reads API key from environment variable (default: `GEMINI_API_KEY`)
- Default model: `gemini-3.1-flash-lite-preview`
- Max output tokens: 4096
- Converts `ChatMessage[]` to Gemini's `Content[]` format (maps `"assistant"` role to `"model"`)
- For image inputs: prepends `inlineData` part to the last user message
- Returns token counts from `response.usageMetadata`

## AnthropicProvider

**File:** `packages/core/src/ai/anthropic-provider.ts`

Uses `@anthropic-ai/sdk` (Anthropic's official Node.js SDK).

- Reads API key from environment variable (default: `ANTHROPIC_API_KEY`)
- Default model: any Anthropic model string (e.g., `claude-sonnet-4-20250514`)
- Max output tokens: 4096
- Sends `system` as a top-level parameter (not as a message)
- For text: maps `ChatMessage[]` directly to Anthropic message format
- For image inputs: attaches a base64 `image` block to the last user message (supports `image/png`, `image/jpeg`, `image/webp`)
- Returns token counts from `response.usage.input_tokens` / `output_tokens`

## OpenAIProvider

**File:** `packages/core/src/ai/openai-provider.ts`

Uses the `openai` SDK (OpenAI's official Node.js SDK).

- Reads API key from environment variable (default: `OPENAI_API_KEY`)
- Default model: any OpenAI model string (e.g., `gpt-4o`, `gpt-4.1`)
- Max output tokens: 4096
- Sends `system` as a system message prepended to the messages array
- For image inputs: attaches a `image_url` block (data URI with base64) to the last user message
- Returns token counts from `response.usage.prompt_tokens` / `completion_tokens`

## CliProvider

**File:** `packages/core/src/ai/cli-provider.ts`

Pipes prompts to CLI tools via stdin using `execa`.

### Supported Commands

| Command | Invocation | Output Parsing |
|---------|-----------|----------------|
| `claude` | `claude -p --output-format json` | JSON: `{ result, total_cost_usd, usage }` |
| `codex` | `codex -q` | Plain text |
| `gemini` | `gemini -p --output-format json` | Plain text |
| Custom | `<command> <args>` | Plain text |

### Prompt Construction

`buildPrompt()` concatenates all messages with `---` separators:

```
[System] <system prompt>
---
[User] <message 1>
---
[Assistant] <message 2>
---
...
```

For image inputs, writes a temp PNG file and appends `[Screenshot attached: /tmp/ghostqa-<id>.png]`.

### Claude JSON Output

When using `claude` with `--output-format json`, the response contains:

```json
{
  "result": "actual LLM response text",
  "total_cost_usd": 0.0234,
  "usage": { "input_tokens": 1500, "output_tokens": 800 }
}
```

The provider extracts `result` as the response text and stores `total_cost_usd` as `reportedCostUsd` for accurate cost tracking.

### Token Estimation

For non-Claude CLI tools (or when JSON parsing fails), tokens are estimated from text length:

```
estimatedTokens = text.length / 4
```

### Configuration

- Timeout: 180 seconds per call
- `reject: false` — stderr warnings don't cause exceptions
- Temp image files are cleaned up after each call

## AiClient

**File:** `packages/core/src/ai/client.ts`

Facade that combines provider management, task routing, and cost tracking.

### Construction

```typescript
const ai = new AiClient(config, cwd);
// config.ai determines default provider
// config.ai.routing determines per-task overrides
```

### Task Routing

```typescript
ai.useTask("diff_analysis");  // Switch to task-specific provider
const response = await ai.chat(system, messages);
ai.resetTask();                // Revert to default provider
```

Available tasks: `"diff_analysis"`, `"exploration"`, `"ui_control"`, `"triage"`

If no routing is configured for a task, the default provider is used.

### Cost Tracking

Every call automatically:

1. Calls the provider
2. Records token usage via `costTracker.track()`
3. For CLI providers, syncs `reportedCostUsd` via `costTracker.addReportedCost()`
4. Runs `costTracker.checkBudget()` (throws `BudgetExceededError` if exceeded)

### Provider Factory

`createProvider(providerConfig)`:

| `provider` value | Created class | Requires |
|-----------------|---------------|----------|
| `"gemini"` | `GeminiProvider` | `api_key_env` environment variable (default: `GEMINI_API_KEY`) |
| `"anthropic"` | `AnthropicProvider` | `api_key_env` environment variable (default: `ANTHROPIC_API_KEY`) |
| `"openai"` | `OpenAIProvider` | `api_key_env` environment variable (default: `OPENAI_API_KEY`) |
| `"cli"` | `CliProvider` | CLI tool installed (`claude`, `codex`, `gemini`, etc.) |

## Cost Tracker

**File:** `packages/core/src/ai/cost-tracker.ts`

### Pricing Table (per million tokens)

**Gemini models:**

| Model | Input | Output |
|-------|-------|--------|
| `gemini-3.1-flash-lite-preview` | $0.10 | $0.40 |
| `gemini-2.5-flash-preview-05-20` | $0.15 | $0.60 |
| `gemini-2.5-pro-preview-05-06` | $1.25 | $10.00 |

**Claude models (Anthropic):**

| Model | Input | Output |
|-------|-------|--------|
| `claude-sonnet-4-20250514` | $3.00 | $15.00 |
| `claude-haiku-3.5` | $0.80 | $4.00 |
| `claude-opus-4` | $15.00 | $75.00 |

**OpenAI models:**

| Model | Input | Output |
|-------|-------|--------|
| `gpt-4o` | $2.50 | $10.00 |
| `gpt-4o-mini` | $0.15 | $0.60 |
| `gpt-4.1` | $2.00 | $8.00 |
| `gpt-4.1-mini` | $0.40 | $1.60 |
| `gpt-4.1-nano` | $0.10 | $0.40 |
| `o3-mini` | $1.10 | $4.40 |

**Default:** (unknown models) | $0.15 | $0.60 |

### Methods

| Method | Description |
|--------|-------------|
| `track(input, output)` | Accumulate token counts |
| `addReportedCost(usd)` | Add CLI-reported cost (takes priority over calculated) |
| `checkBudget()` | Throws `BudgetExceededError` if over budget |
| `totalCostUsd()` | Returns reported cost if available, else calculated |
| `summary()` | Returns `{ total_usd, input_tokens, output_tokens, is_rate_limited }` |

### CLI vs API Cost Display

- **API providers** (Gemini, Anthropic, OpenAI): show USD cost calculated from tokens
- **CLI providers** (claude/codex/gemini): set `isRateLimited = true`, display guidance text ("check claude -> /usage") instead of cost

## JSON Parsing

**File:** `packages/core/src/ai/parse-json.ts`

`extractJson<T>(text)` uses a 3-tier strategy to extract JSON from LLM responses:

### Tier 1: Direct Parse

```
Unescape literal \n, \t, \r sequences → JSON.parse()
```

CLI tools sometimes return single-line strings with literal backslash-n instead of actual newlines.

### Tier 2: Code Block Extraction

```
Regex match ```json ... ``` or ``` ... ``` → fixAndParse()
```

### Tier 3: Brace Scan

```
Find outermost { ... } with depth tracking → fixAndParse()
```

Handles nested braces, string content (including escaped quotes), and ignores braces inside strings.

### `fixAndParse(raw)`

Applies repairs before parsing:

1. Direct `JSON.parse()`
2. Strip trailing commas before `}` or `]`
3. Convert single-quoted keys to double-quoted (regex: `'key':` → `"key":`)
